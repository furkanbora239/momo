/**
 * M7 `--self-test` driver + standing regression exam engine.
 *
 * Wraps the M1d sandbox-QA pattern end to end against V2 `/api/*` routes only:
 *   sandbox up (isolated XDG + seeded config/auth) -> pre-flight hard asserts
 *   -> parent spawns 5 parallel background children -> wait -> dump sessions +
 *   messages -> verdict-noise grep -> PASS/FAIL -> cleanup.
 *
 * Modes:
 *   --self-test   quick harness proof (~40s): pre-flight + spawn + survival/no-noise.
 *   --full        full M1d pattern (~120s) + completion + tool surface + evidence.
 *   --regression  alias of --full used by the standing regression exam entrypoint.
 *
 * Hard asserts BEFORE any prompting: health returns JSON (not HTML), POST
 * /api/session returns a non-empty id, and the momo plugin (from the repo dist)
 * is loaded (opencode-go present in the provider list + serve.log marker). Any
 * failed assert exits non-zero naming the failing assert.
 */
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  QA_API,
  VERDICT_NOISE_MARKERS,
  RUNBOOK_MODEL,
  REQUIRED_PARALLEL_CHILDREN,
  WAIT_FULL_MS,
  WAIT_SELFTEST_MS,
  PROVIDER_POLL_MS,
  PARENT_PROMPT,
  type QaOptions,
  type QaResult,
} from "./opencode-v2-qa-types.ts"
import { seedSandbox } from "./opencode-v2-qa-seed.ts"

const AUTH_USER = "opencode"

function redact(text: string, secrets: string[]): string {
  let out = text
  for (const s of secrets) {
    if (s) out = out.split(s).join("<REDACTED>")
  }
  return out
}

function findFreePort(): number {
  const s = createServer()
  s.listen(0, "127.0.0.1")
  const addr = s.address() as { port: number }
  const p = addr.port
  s.close()
  return p
}

class ApiClient {
  constructor(private base: string, private auth: string, private secrets: string[]) {}
  private async json(path: string, init?: RequestInit): Promise<any> {
    const res = await fetch(this.base + path, {
      ...init,
      headers: { ...(init?.headers ?? {}), Authorization: `Basic ${this.auth}` },
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`API ${path} -> ${res.status}: ${redact(text.slice(0, 200), this.secrets)}`)
    return JSON.parse(text)
  }
  async providers(): Promise<string[]> {
    const d = await this.json(QA_API.provider)
    return (d.data ?? []).map((p: any) => p.id)
  }
  async createSession(): Promise<string> {
    const d = await this.json(QA_API.sessionCreate, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    return d.data?.id
  }
  async prompt(id: string, text: string): Promise<void> {
    await this.json(QA_API.sessionPrompt(id), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    })
  }
  async listSessions(): Promise<any[]> {
    const d = await this.json(QA_API.sessionList)
    return d.data ?? []
  }
  async messages(id: string): Promise<any[]> {
    const d = await this.json(QA_API.sessionMessages(id))
    return d.data ?? []
  }
  async healthRaw(): Promise<string> {
    const res = await fetch(this.base + QA_API.health, {
      headers: { Authorization: `Basic ${this.auth}` },
    })
    return res.text()
  }
}

function collectToolNames(parts: any): Set<string> {
  const names = new Set<string>()
  const walk = (ps: any): void => {
    if (!Array.isArray(ps)) return
    for (const p of ps) {
      if (p && typeof p === "object") {
        if (["tool", "tool_call", "tool-invocation"].includes(p.type)) {
          const n = p.name ?? p.toolName ?? p.tool
          if (typeof n === "string") names.add(n)
        }
        walk(p.parts)
        walk(p.content)
      }
    }
  }
  walk(parts)
  return names
}

function countMarker(log: string, marker: string): number {
  return log.split(marker).length - 1
}

export async function runQa(opts: QaOptions): Promise<QaResult> {
  const failures: string[] = []
  const sandboxRoot = await makeSandbox(opts.sandboxBase)
  let proc: ReturnType<typeof Bun.spawn> | null = null
  let port = opts.port ?? findFreePort()
  const evidenceDir = opts.evidenceDir
    ?? join(process.cwd(), ".omo", "evidence", "20261005-m7-qa-infra")
  mkdirSync(evidenceDir, { recursive: true })

  const secretFor = (p: string): string[] => {
    const secrets: string[] = []
    try {
      secrets.push(JSON.parse(readFileSync(join(sandboxRoot, "config", "opencode", "service.json"), "utf8")).password)
    } catch {}
    try {
      secrets.push(JSON.parse(readFileSync(join(sandboxRoot, "data", "opencode", "auth.json"), "utf8"))["opencode-go"]?.key ?? "")
    } catch {}
    return secrets.filter(Boolean)
  }

  try {
    const manifest = seedSandbox(sandboxRoot)
    if (!manifest.opencodeGoSeeded) failures.push("seed: opencode-go provider not injected")

    const bin = opts.opencodeBin ?? Bun.which("opencode") ?? "/usr/local/bin/opencode"
    const env = {
      ...process.env,
      XDG_DATA_HOME: join(sandboxRoot, "data"),
      XDG_CONFIG_HOME: join(sandboxRoot, "config"),
      XDG_STATE_HOME: join(sandboxRoot, "state"),
      XDG_CACHE_HOME: join(sandboxRoot, "cache"),
      TMPDIR: join(sandboxRoot, "tmp"),
    }
    const logPath = join(sandboxRoot, "serve.log")
    proc = Bun.spawn([bin, "serve", "--service", "--hostname", "127.0.0.1", "--port", String(port)], {
      env,
      stdout: Bun.file(logPath),
      stderr: Bun.file(logPath),
    })

    const secrets = secretFor(sandboxRoot)
    const authRaw = Buffer.from(`${AUTH_USER}:${secrets[0] ?? ""}`).toString("base64")
    const api = new ApiClient(`http://127.0.0.1:${port}`, authRaw, secrets)

    // ---- pre-flight asserts ----
    await waitFor(() => api.healthRaw().then((t) => !t.includes("<!doctype")), 15000, "health JSON")
    const health = await api.healthRaw()
    if (health.includes("<!doctype")) failures.push("assert: health returned HTML (v1 catch-all)")
    try {
      JSON.parse(health)
    } catch {
      failures.push("assert: health not valid JSON")
    }

    const parentId = await api.createSession()
    if (!parentId) failures.push("assert: POST /api/session returned empty id")

    let pluginLoaded = false
    for (let i = 0; i < PROVIDER_POLL_MS / 1000; i++) {
      const ids = await api.providers().catch(() => [])
      if (ids.includes("opencode-go")) {
        pluginLoaded = true
        break
      }
      await sleep(1000)
    }
    if (!pluginLoaded) failures.push("assert: momo plugin not loaded (opencode-go absent from provider list)")
    const serveLog0 = readFileSync(logPath, "utf8")
    if (!/model-catalog-cli\.ts|oh-my-opencode|v2-compaction-hook-bridge/.test(serveLog0))
      failures.push("assert: serve.log missing momo plugin marker")

    if (failures.length) throw new Error(failures.join("; "))

    // ---- dispatch ----
    await api.prompt(parentId, PARENT_PROMPT)

    // ---- poll children ----
    let childIds: string[] = []
    for (let i = 0; i < 30; i++) {
      await sleep(5000)
      const all = await api.listSessions()
      childIds = all.filter((s) => s.id !== parentId).map((s) => s.id)
      if (childIds.length >= REQUIRED_PARALLEL_CHILDREN) break
    }
    if (childIds.length < REQUIRED_PARALLEL_CHILDREN)
      failures.push(`assert: only ${childIds.length} child sessions (expected >=${REQUIRED_PARALLEL_CHILDREN})`)

    // ---- wait for completion ----
    await sleep(opts.mode === "self-test" ? WAIT_SELFTEST_MS : WAIT_FULL_MS)

    const sessions = await api.listSessions()
    const finalChildIds = sessions.filter((s) => s.id !== parentId).map((s) => s.id)
    const toolUnion = new Set<string>()
    let childrenWithToolSurface = 0
    let missing = 0
    for (const id of finalChildIds) {
      const msgs = await api.messages(id)
      const names = collectToolNames(msgs.flatMap((m) => m.parts ?? m.content ?? []))
      names.forEach((n) => toolUnion.add(n))
      if (names.size > 0) childrenWithToolSurface++
      if (msgs.length === 0) missing++
    }

    const serveLog = readFileSync(logPath, "utf8")
    const verdictNoise: Record<string, number> = {}
    for (const m of VERDICT_NOISE_MARKERS) {
      const c = countMarker(serveLog, m)
      verdictNoise[m] = c
      if (c > 0) failures.push(`assert: verdict-noise marker present: ${m} (${c})`)
    }

    // ---- full/regression completion gate ----
    if (opts.mode !== "self-test") {
      if (missing > 0) failures.push(`assert: ${missing} child session(s) produced no messages (did not complete)`)
      const manifestSurface = JSON.parse(
        readFileSync(join(import.meta.dir, "opencode-v2-qa-tool-surface.json"), "utf8"),
      )
      const baseline = manifestSurface.requiredBaseline as string[]
      if (!baseline.some((b) => toolUnion.has(b)))
        failures.push(`assert: child tool surface missing required baseline ${baseline.join("/")}`)

      // M2b per-agent hard gates. Worker-class agents carry the promoted
      // advisoryPresence as a requiredPresence gate (declared expected surface)
      // and a livePresenceGate (the subset the M7 sandbox can actually exercise).
      // Every agent carries a removed gate (no tool MAY be observed). The exam
      // dispatches worker-class (sisyphus-junior) children via category quick.
      const agents = (manifestSurface.agents ?? {}) as Record<
        string,
        { class: string; requiredPresence: string[]; livePresenceGate: string[]; removed: string[] }
      >
      for (const [agent, entry] of Object.entries(agents)) {
        const live = entry.livePresenceGate ?? []
        const removed = entry.removed ?? []
        if (entry.class === "worker") {
          for (const t of live) {
            if (!toolUnion.has(t))
              failures.push(`assert: worker ${agent} live surface missing ${t}`)
          }
        }
        for (const t of removed) {
          if (toolUnion.has(t))
            failures.push(`assert: ${agent} surface contains removed tool ${t}`)
        }
      }
    }

    // ---- evidence ----
    writeEvidence(evidenceDir, {
      secrets,
      serveLog,
      sessions,
      parentId,
      finalChildIds,
      toolUnion: [...toolUnion],
      verdictNoise,
      failures,
      port,
      mode: opts.mode,
    })

    const passed = failures.length === 0
    return {
      mode: opts.mode,
      passed,
      failures,
      childCount: finalChildIds.length,
      childrenWithToolSurface,
      toolUnion: [...toolUnion],
      verdictNoise,
      evidenceDir,
      sandboxDir: sandboxRoot,
      port,
    }
  } finally {
    if (proc) proc.kill()
    if (!opts.keepSandbox) rmSync(sandboxRoot, { recursive: true, force: true })
  }
}

async function makeSandbox(base?: string): Promise<string> {
  const root = base ?? join(tmpdir(), "opencode-v2-qa")
  mkdirSync(root, { recursive: true })
  const dir = join(root, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeEvidence(
  dir: string,
  d: {
    secrets: string[]
    serveLog: string
    sessions: any[]
    parentId: string
    finalChildIds: string[]
    toolUnion: string[]
    verdictNoise: Record<string, number>
    failures: string[]
    port: number
    mode: string
  },
): void {
  const red = (s: string) => redact(s, d.secrets)
  writeFileSync(join(dir, "serve-log-excerpt.log"), red(d.serveLog))
  writeFileSync(join(dir, "sessions.json"), red(JSON.stringify(d.sessions, null, 2)))
  const greps = VERDICT_NOISE_MARKERS.map((m) => `${m} = ${d.verdictNoise[m] ?? 0}`).join("\n")
  writeFileSync(join(dir, "greps.txt"), red(`${greps}\nchildCount = ${d.finalChildIds.length}\ntoolUnion = ${d.toolUnion.join(" ")}\n`))
  const summary = [
    `# M7 opencode-v2 QA (${new Date().toISOString()})`,
    "",
    `mode: ${d.mode}  port: ${d.port}`,
    `parent: ${d.parentId}`,
    `children: ${d.finalChildIds.length}`,
    `toolUnion: ${d.toolUnion.join(" ")}`,
    `verdictNoise: ${JSON.stringify(d.verdictNoise)}`,
    `failures: ${d.failures.length ? d.failures.join("; ") : "none"}`,
    "",
    "Seeded files (provider cache seed): config/opencode/opencode.json (+opencode-go inject),",
    "service.json, data/opencode/auth.json, cache/oh-my-opencode/provider-models.json,",
    "cache/oh-my-opencode/connected-providers.json.",
  ].join("\n")
  writeFileSync(join(dir, "summary.md"), red(summary))
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn: () => Promise<boolean>, ms: number, label: string): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return
    await sleep(500)
  }
  throw new Error(`timeout waiting for ${label}`)
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2)
  const mode: QaOptions["mode"] = args.includes("--self-test")
    ? "self-test"
    : args.includes("--regression")
      ? "regression"
      : "full"
  const keep = args.includes("--keep")
  const result = await runQa({ mode, keepSandbox: keep })
  console.log(`M7 QA (${mode}): ${result.passed ? "PASS" : "FAIL"}`)
  console.log(`  children: ${result.childCount}, toolSurface: ${result.childrenWithToolSurface}, tools: ${result.toolUnion.join(" ")}`)
  console.log(`  verdictNoise: ${JSON.stringify(result.verdictNoise)}`)
  console.log(`  evidence: ${result.evidenceDir}`)
  if (!result.passed) {
    console.log(`  failures: ${result.failures.join("; ")}`)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
