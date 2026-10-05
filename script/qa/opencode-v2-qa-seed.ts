/**
 * M7 provider-cache seed.
 *
 * Makes an isolated XDG sandbox resolve `opencode-go/deepseek-v4-flash`
 * deterministically, closing the empty-child P3 gap from M1d.
 *
 * What gets seeded (and why):
 *  - `opencode.json`  (copied from the real config, then patched): adds an
 *    explicit `opencode-go` provider block. In the sandbox the real `go-b`
 *    provider cannot authenticate (its key lives in an env var that is not
 *    present), so momo's catalog never injects `opencode-go` and children fail
 *    at provider resolution. Adding `opencode-go` as a first-class provider with
 *    a literal key (read from `auth.json`, never printed) makes the model
 *    resolvable regardless of live reconciliation.
 *  - `service.json`   (copied): the `opencode serve` Basic-auth password.
 *  - `auth.json`      (copied): provider API keys for any non-seeded provider.
 *  - `provider-models.json` + `connected-providers.json` (generated): the momo
 *    provider-models cache, so `opencode-go` is reported connected even before
 *    the live `/models` reconciliation finishes.
 *
 * The real opencode state is only READ. Nothing under ~/.local/share/opencode
 * or ~/.config/opencode is modified.
 */
import { mkdirSync, copyFileSync, writeFileSync, readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"

import { RUNBOOK_MODEL } from "./opencode-v2-qa-types.ts"

export interface SeedManifest {
  sandboxRoot: string
  seeded: Array<{ path: string; kind: string; reason: string }>
  opencodeGoSeeded: boolean
}

function realConfigDir(): string {
  return Bun.env.OMO_REAL_OPENCODE_CONFIG_DIR
    ?? join(homedir(), ".config", "opencode")
}
function realDataDir(): string {
  return Bun.env.OMO_REAL_OPENCODE_DATA_DIR
    ?? join(homedir(), ".local", "share", "opencode")
}

/** Minimal JSONC stripper (remove line and block comments outside strings). */
export function stripJsonc(text: string): string {
  const out: string[] = []
  let i = 0
  const n = text.length
  let instr: string | null = null
  while (i < n) {
    const c = text[i]
    if (instr) {
      out.push(c)
      if (c === "\\" && i + 1 < n) {
        out.push(text[i + 1])
        i += 2
        continue
      }
      if (c === instr) instr = null
      i += 1
      continue
    }
    if (c === '"' || c === "'") {
      instr = c
      out.push(c)
      i += 1
      continue
    }
    if (c === "/" && i + 1 < n && text[i + 1] === "/") {
      const j = text.indexOf("\n", i)
      i = j === -1 ? n : j
      continue
    }
    if (c === "/" && i + 1 < n && text[i + 1] === "*") {
      const j = text.indexOf("*/", i + 2)
      i = j === -1 ? n : j + 2
      continue
    }
    out.push(c)
    i += 1
  }
  return out.join("")
}

/**
 * Add (or complete) an explicit `opencode-go` provider in the sandbox config so
 * the runbook model resolves. The api key is read from `auth.json` (read-only)
 * and injected as a literal; it is never returned or printed by this function.
 */
export function withOpenCodeGoProvider(
  cfgText: string,
  authText: string,
): string {
  const cfg = JSON.parse(stripJsonc(cfgText))
  const auth = JSON.parse(authText)
  const key = auth?.["opencode-go"]?.key
  if (!key) {
    throw new Error("auth.json has no opencode-go.key; cannot seed provider")
  }
  const providers = cfg.providers ?? (cfg.providers = {})
  let src = providers["go-b"]
  if (!src) {
    for (const p of Object.values<any>(providers)) {
      const base = p?.settings?.baseURL ?? ""
      if (base.includes("opencode.ai/zen/go")) {
        src = p
        break
      }
    }
  }
  const base = src?.settings?.baseURL ?? "https://opencode.ai/zen/go/v1"
  const pkg = src?.package ?? "aisdk:@ai-sdk/openai-compatible"
  const [providerId, modelId] = RUNBOOK_MODEL.split("/")
  if (!providers[providerId]) {
    providers[providerId] = {
      name: "OpenCode Go (M7 seed)",
      package: pkg,
      settings: { baseURL: base, apiKey: key },
      models: {
        [modelId]: {
          name: `${modelId} (seed)`,
          capabilities: { tools: true, input: ["text"], output: ["text"] },
        },
      },
    }
  } else {
    providers[providerId].settings ??= {}
    providers[providerId].settings.apiKey = key
    providers[providerId].settings.baseURL =
      providers[providerId].settings.baseURL ?? base
  }
  cfg.providers = providers
  return JSON.stringify(cfg, null, 2)
}

/** Seed one isolated XDG sandbox rooted at `sandboxRoot`. */
export function seedSandbox(sandboxRoot: string): SeedManifest {
  const cfgDir = realConfigDir()
  const dataDir = realDataDir()
  const srcCfg = join(cfgDir, "opencode.json")
  const srcSvc = join(cfgDir, "service.json")
  const srcAuth = join(dataDir, "auth.json")

  for (const d of [
    join(sandboxRoot, "config", "opencode"),
    join(sandboxRoot, "data", "opencode"),
    join(sandboxRoot, "cache", "oh-my-opencode"),
  ]) {
    mkdirSync(d, { recursive: true })
  }

  const seeded: SeedManifest["seeded"] = []
  copyFileSync(srcCfg, join(sandboxRoot, "config", "opencode", "opencode.json"))
  seeded.push({
    path: "config/opencode/opencode.json",
    kind: "copy+patch",
    reason: "real config copied; opencode-go provider injected for deterministic model resolution",
  })
  copyFileSync(srcSvc, join(sandboxRoot, "config", "opencode", "service.json"))
  seeded.push({
    path: "config/opencode/service.json",
    kind: "copy",
    reason: "opencode serve Basic-auth password source",
  })
  copyFileSync(srcAuth, join(sandboxRoot, "data", "opencode", "auth.json"))
  seeded.push({
    path: "data/opencode/auth.json",
    kind: "copy",
    reason: "provider API keys for any non-seeded provider",
  })

  // Patch the copied config to add the opencode-go provider.
  const cfgText = readFileSync(join(sandboxRoot, "config", "opencode", "opencode.json"), "utf8")
  const authText = readFileSync(join(sandboxRoot, "data", "opencode", "auth.json"), "utf8")
  const patched = withOpenCodeGoProvider(cfgText, authText)
  writeFileSync(join(sandboxRoot, "config", "opencode", "opencode.json"), patched)

  // Provider-models cache (momo reads this before live reconciliation).
  const now = new Date().toISOString()
  const providerModels = {
    models: {
      "opencode-go": [modelIdOf(RUNBOOK_MODEL)],
      neuralwatt: [],
      google: [],
      evren: [],
      ollama: [],
      opencode: [],
      nvidia: [],
    },
    registryModels: { "opencode-go": [modelIdOf(RUNBOOK_MODEL)] },
    connected: ["opencode-go", "neuralwatt", "google", "evren", "ollama", "opencode", "nvidia"],
    updatedAt: now,
  }
  writeFileSync(
    join(sandboxRoot, "cache", "oh-my-opencode", "provider-models.json"),
    JSON.stringify(providerModels, null, 2),
  )
  writeFileSync(
    join(sandboxRoot, "cache", "oh-my-opencode", "connected-providers.json"),
    JSON.stringify({ connected: providerModels.connected, updatedAt: now }, null, 2),
  )
  seeded.push({
    path: "cache/oh-my-opencode/provider-models.json",
    kind: "generate",
    reason: "momo provider-models cache: opencode-go reported connected pre-reconciliation",
  })
  seeded.push({
    path: "cache/oh-my-opencode/connected-providers.json",
    kind: "generate",
    reason: "momo connected-providers cache",
  })

  return {
    sandboxRoot,
    seeded,
    opencodeGoSeeded: patched.includes('"opencode-go"'),
  }
}

function modelIdOf(model: string): string {
  return model.split("/")[1] ?? "deepseek-v4-flash"
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2)
  const planOnly = args.includes("--plan")
  const applyIdx = args.indexOf("--apply")
  const dir = applyIdx >= 0 ? args[applyIdx + 1] : undefined
  if (planOnly || !dir) {
    console.log("M7 provider-cache seed plan")
    console.log("  copies: ~/.config/opencode/opencode.json (+ opencode-go provider inject)")
    console.log("          ~/.config/opencode/service.json")
    console.log("          ~/.local/share/opencode/auth.json")
    console.log("  generates: <sandbox>/cache/oh-my-opencode/provider-models.json")
    console.log("             <sandbox>/cache/oh-my-opencode/connected-providers.json")
    console.log("  run with: bun script/qa/opencode-v2-qa-seed.ts --apply <sandbox-root>")
    if (!dir) process.exit(planOnly ? 0 : 1)
  }
  if (!existsSync(realConfigDir())) {
    console.error(`real config dir not found: ${realConfigDir()}`)
    process.exit(1)
  }
  const manifest = seedSandbox(dir)
  console.log(`seeded sandbox: ${manifest.sandboxRoot}`)
  for (const s of manifest.seeded) {
    console.log(`  + ${s.path} [${s.kind}] ${s.reason}`)
  }
  console.log(`opencode-go seeded: ${manifest.opencodeGoSeeded}`)
}

if (import.meta.main) {
  await main()
}
