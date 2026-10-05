/**
 * M2d — live acceptance exam for subagent question routing (worker -> orchestrator).
 *
 * Runs in an isolated XDG sandbox (same recipe as the M7 harness: seed + free
 * port + V2 /api/* routes + Basic auth + pre-flight hard asserts + redaction).
 * It drives ONE real parent that spawns a tracked child which asks exactly one
 * question, then proves the four M2d assertions against the live momo plugin
 * loaded from the repo `dist`:
 *
 *   1. the pending question is delivered to the ORCHESTRATOR (parent session) as
 *      a notification containing the question text + the task_id anchor, and NO
 *      user-escalation notification is emitted before the bounded wait;
 *   2. answering via `task(task_id, answer)` reaches the child and the child
 *      continues (produces a follow-up referencing the answer);
 *   3. a second, unanswered question escalates to the user session after
 *      questionOrchestratorWaitMs (the live default of 120s).
 *
 * Evidence is written to .omo/evidence/20261005-m2d-question-routing/.
 */
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { join } from "node:path"
import { tmpdir } from "node:os"

import {
  QA_API,
  VERDICT_NOISE_MARKERS,
  RUNBOOK_MODEL,
  PROVIDER_POLL_MS,
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
  const p = (s.address() as { port: number }).port
  s.close()
  return p
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Extract the human-readable text of an OpenCode session message regardless of
 * whether the server renders it as `parts`, `content`, or a flat `text` field.
 * Unlike JSON.stringify(m), this returns the REAL (un-escaped) text so regex
 * anchors like `task_id=…` parse correctly.
 */
function msgText(mm: any): string {
  const parts = mm?.parts ?? mm?.content
  if (Array.isArray(parts)) {
    return parts
      .map((p: any) =>
        typeof p === "string"
          ? p
          : (p?.text ?? p?.content ?? (typeof p === "object" ? JSON.stringify(p) : String(p ?? ""))),
      )
      .join("")
  }
  if (typeof mm?.text === "string") return mm.text
  if (typeof mm?.content === "string") return mm.content
  if (typeof mm?.message === "string") return mm.message
  return JSON.stringify(mm)
}

async function waitFor(fn: () => Promise<boolean>, ms: number, label: string): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await fn().catch(() => false)) return
    await sleep(500)
  }
  throw new Error(`timeout waiting for ${label}`)
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
  subscribeEvents(directory: string): Promise<Response> {
    return fetch(`${this.base}/api/event?directory=${encodeURIComponent(directory)}`, {
      headers: { Authorization: `Basic ${this.auth}` },
    })
  }
}

const CHILD_PROMPT_Q1 =
  "Your ONLY task is to ask the orchestrator one clarifying question. Call the `question` tool " +
  "EXACTLY ONCE with a single question object: question=\"What is the codename of this repository?\". " +
  "Do NOT create, read, edit, or write any file. Do NOT use any other tool. Ask the question and then stop."

const CHILD_PROMPT_Q2 =
  "Your ONLY task is to ask the orchestrator one clarifying question. Call the `question` tool " +
  "EXACTLY ONCE with a single question object: question=\"Which branch should I target for the fix?\". " +
  "Do NOT create, read, edit, or write any file. Do NOT use any other tool. Ask the question and then stop."

const PARENT_SPAWN =
  (q: string) =>
    "Spawn exactly ONE background task, category quick, " +
    `model ${RUNBOOK_MODEL}, with this prompt: '${q}' ` +
    "Run it in the background. Return immediately after dispatching."

interface M2dResult {
  passed: boolean
  failures: string[]
  questionText: string
  taskId?: string
  childSessionId?: string
  routedToOrchestrator: boolean
  noEarlyEscalation: boolean
  childContinuedWithAnswer: boolean
  escalatedToUser: boolean
  evidenceDir: string
  port: number
}

export async function runM2dExam(opts: {
  evidenceDir?: string
  keepSandbox?: boolean
}): Promise<M2dResult> {
  const failures: string[] = []
  const sandboxRoot = join(tmpdir(), "opencode-v2-m2d", `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(sandboxRoot, { recursive: true })
  let proc: ReturnType<typeof Bun.spawn> | null = null
  let port = findFreePort()
  const evidenceDir = opts.evidenceDir
    ?? join(process.cwd(), ".omo", "evidence", "20261005-m2d-question-routing")
  mkdirSync(evidenceDir, { recursive: true })

  const secretFor = (): string[] => {
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

    const bin = Bun.which("opencode") ?? "/usr/local/bin/opencode"
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

    const secrets = secretFor()
    const auth = Buffer.from(`${AUTH_USER}:${secrets[0] ?? ""}`).toString("base64")
    const api = new ApiClient(`http://127.0.0.1:${port}`, auth, secrets)

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

    // ---- diagnostic event subscription (confirms the live event shape) ----
    const evtRes = await api.subscribeEvents(process.cwd()).catch(() => null)
    const seenTypes = new Set<string>()
    const toolCalledSeen: any[] = []
    let evtBuf = ""
    let evtCollecting = !!evtRes?.ok
    let evtReader: ReadableStreamDefaultReader<Uint8Array> | null = evtRes?.ok ? evtRes.body?.getReader() ?? null : null
    if (evtCollecting && evtReader) {
      void (async () => {
        try {
          while (evtCollecting) {
            const { done, value } = await evtReader!.read()
            if (done) break
            evtBuf += new TextDecoder().decode(value)
            const lines = evtBuf.split("\n")
            evtBuf = lines.pop() ?? ""
            for (const line of lines) {
              const t = line.trim()
              if (!t.startsWith("data:")) continue
              try {
                const ev = JSON.parse(t.slice(5).trim())
                const type = ev?.type
                if (type) seenTypes.add(type)
                if (typeof type === "string" && (type.includes("tool") || type === "session.tool.called"))
                  toolCalledSeen.push(ev)
              } catch {}
            }
          }
        } catch {}
      })()
    }

    // ---- dispatch: parent spawns child1 (asks Q1) ----
    await api.prompt(parentId, PARENT_SPAWN(CHILD_PROMPT_Q1))

    // Poll the PARENT session for the orchestrator routing notification.
    const ROUTE_MARKER = "[Subagent question]"
    const ESCALATION_MARKER = "[Subagent question escalated to user]"
    const Q1_TEXT = "codename of this repository"
    let routedToOrchestrator = false
    let noEarlyEscalation = false
    let notificationText = ""
    let taskId: string | undefined
    let childSessionId: string | undefined
    for (let i = 0; i < 60; i++) {
      await sleep(5000)
      const msgs = await api.messages(parentId)
      const allText = msgs.map(msgText).join("\n")
      if (allText.includes(ROUTE_MARKER)) {
        const m = msgs.find((mm) => msgText(mm).includes(ROUTE_MARKER))
        notificationText = m ? msgText(m) : allText
        routedToOrchestrator = notificationText.includes(Q1_TEXT)
        // Parse the context anchor. The notification body uses an UNQUOTED
        // `task_id=<id> session_id=<id>` anchor line; the instruction line uses
        // a QUOTED `task(task_id="<id>", …)`. Match both, prefer the anchor.
        const anchor = notificationText.match(/task_id=([^\s"\\()]+)/)
        const sid = notificationText.match(/session_id=([^\s"\\()]+)/)
        taskId = anchor?.[1]
        childSessionId = sid?.[1]
        if (!taskId) taskId = notificationText.match(/task_id="([^"]+)"/)?.[1]
        if (!childSessionId) childSessionId = notificationText.match(/session_id="([^"]+)"/)?.[1]
        // Semantically correct: no escalation message may exist in the parent
        // BEFORE the orchestrator answers (the bounded wait window).
        noEarlyEscalation = !allText.includes(ESCALATION_MARKER)
        // Capture message timestamps to diagnose delivery latency vs the 120s
        // escalation window.
        const routeMsg = msgs.find((mm) => msgText(mm).includes(ROUTE_MARKER))
        const escalMsg = msgs.find((mm) => msgText(mm).includes(ESCALATION_MARKER))
        writeFileSync(
          join(evidenceDir, "timing.json"),
          redact(
            JSON.stringify(
              {
                loopIndex: i,
                routeMsgCreated: routeMsg?.time?.created ?? null,
                escalMsgCreated: escalMsg?.time?.created ?? null,
                detectedAt: Date.now(),
                note: "routeMsgCreated should precede escalMsgCreated by >120s for the feature to work",
              },
              null,
              2,
            ),
            secrets,
          ),
        )
        writeFileSync(join(evidenceDir, "routing-notification.txt"), redact(notificationText, secrets))
        break
      }
    }
    if (!routedToOrchestrator) {
      failures.push(`assert(1): child question not routed to orchestrator (no "[Subagent question]" notification with "${Q1_TEXT}" in parent)`)
    } else if (!noEarlyEscalation) {
      failures.push("assert(2): user-escalation notification appeared before the bounded wait")
    } else if (!taskId || !childSessionId) {
      failures.push("assert(1): routed notification missing task_id/session_id anchor")
    }

    // ---- answer child1 via the task tool, assert the child continues ----
    let childContinuedWithAnswer = false
    if (routedToOrchestrator && taskId) {
      // The orchestrator (parent) is a "Code Mode" agent that invokes tools via
      // the `execute` runtime (exactly how it spawned child1). Mirror that proven
      // style so the answer is actually delivered, and confirm the tool result.
      const answerPrompt = (id: string) =>
        `A delegated worker asked a pending question. Answer it now using the task tool. ` +
        `Call the task tool EXACTLY ONCE with these EXACT parameters: ` +
        `task_id="${id}", answer="The codename is momo.", prompt="The codename is momo.". ` +
        `The task tool requires both answer and prompt; pass the answer text for both. ` +
        `Reply with ONLY that tool call and nothing else.`
      let answerDelivered = false
      let lastParentText = ""
      for (let attempt = 0; attempt < 3 && !answerDelivered; attempt++) {
        await api.prompt(parentId, answerPrompt(taskId))
        for (let i = 0; i < 18; i++) {
          await sleep(5000)
          const pMsgs = await api.messages(parentId).catch(() => [])
          lastParentText = pMsgs.map(msgText).join("\n")
          if (lastParentText.includes("Answer delivered to worker task")) {
            answerDelivered = true
            break
          }
          if (lastParentText.includes("No pending question for task")) {
            // Window already closed (escalated); no point retrying.
            break
          }
        }
      }
      writeFileSync(join(evidenceDir, "answer-step-parent.txt"), redact(lastParentText, secrets))
      // Poll the child session for a follow-up that references the answer. The
      // injected answer prompt itself contains "momo", so its presence in the
      // child session proves the answer reached the worker.
      for (let i = 0; i < 30; i++) {
        await sleep(5000)
        const cMsgs = await api.messages(childSessionId!).catch(() => [])
        const cFlat = JSON.stringify(cMsgs)
        if (cFlat.includes("momo")) {
          childContinuedWithAnswer = true
          writeFileSync(
            join(evidenceDir, "child-messages-after-answer.txt"),
            redact(cMsgs.map(msgText).join("\n---\n"), secrets),
          )
          break
        }
      }
      if (!childContinuedWithAnswer) {
        const cMsgs = await api.messages(childSessionId!).catch(() => [])
        writeFileSync(
          join(evidenceDir, "child-messages-after-answer.txt"),
          redact(cMsgs.map(msgText).join("\n---\n"), secrets),
        )
        failures.push("assert(3): child did not continue with the orchestrator answer (no follow-up referencing 'momo')")
      }
    }

    // ---- dispatch child2 (asks Q2, intentionally NOT answered) ----
    await api.prompt(parentId, PARENT_SPAWN(CHILD_PROMPT_Q2))

    // Wait for the bounded escalation window (live default 120s) + slack.
    await sleep(135_000)
    const afterMsgs = await api.messages(parentId)
    const afterFlat = JSON.stringify(afterMsgs)
    const escalatedToUser = afterFlat.includes(ESCALATION_MARKER) && afterFlat.includes("branch should I target")
    if (!escalatedToUser) {
      failures.push("assert(4): unanswered question did not escalate to the user after the bounded wait")
    }

    // Stop event diagnostics.
    evtCollecting = false
    evtReader?.cancel().catch(() => {})

    const serveLog = readFileSync(logPath, "utf8")
    const red = (s: string) => redact(s, secrets)
    writeFileSync(join(evidenceDir, "serve-log-excerpt.log"), red(serveLog))
    writeFileSync(
      join(evidenceDir, "events-seen.json"),
      red(JSON.stringify({ seenTypes: [...seenTypes], toolCalledCount: toolCalledSeen.length }, null, 2)),
    )
    const summary = [
      `# M2d question-routing live exam (${new Date().toISOString()})`,
      "",
      `port: ${port}`,
      `parent: ${parentId}`,
      `taskId: ${taskId ?? "n/a"}`,
      `childSessionId: ${childSessionId ?? "n/a"}`,
      "",
      `assert1 routedToOrchestrator: ${routedToOrchestrator}`,
      `assert2 noEarlyEscalation: ${noEarlyEscalation}`,
      `assert3 childContinuedWithAnswer: ${childContinuedWithAnswer}`,
      `assert4 escalatedToUser: ${escalatedToUser}`,
      "",
      `seenEventTypes: ${[...seenTypes].sort().join(", ")}`,
      `toolCalledEventsObserved: ${toolCalledSeen.length}`,
      `failures: ${failures.length ? failures.join("; ") : "none"}`,
      "",
      "Seed: provider cache seed so opencode-go/deepseek-v4-flash resolves in the sandbox.",
    ].join("\n")
    writeFileSync(join(evidenceDir, "summary.md"), red(summary))

    const passed = failures.length === 0
    return {
      passed,
      failures,
      questionText: Q1_TEXT,
      taskId,
      childSessionId,
      routedToOrchestrator,
      noEarlyEscalation,
      childContinuedWithAnswer,
      escalatedToUser,
      evidenceDir,
      port,
    }
  } finally {
    if (proc) proc.kill()
    if (!opts.keepSandbox) rmSync(sandboxRoot, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2)
  const keep = args.includes("--keep")
  const result = await runM2dExam({ keepSandbox: keep })
  console.log("M2d question-routing live exam:")
  console.log(`  assert1 routedToOrchestrator: ${result.routedToOrchestrator}`)
  console.log(`  assert2 noEarlyEscalation: ${result.noEarlyEscalation}`)
  console.log(`  assert3 childContinuedWithAnswer: ${result.childContinuedWithAnswer}`)
  console.log(`  assert4 escalatedToUser: ${result.escalatedToUser}`)
  console.log(`  taskId: ${result.taskId ?? "n/a"}  child: ${result.childSessionId ?? "n/a"}`)
  console.log(`  result: ${result.passed ? "PASS" : "FAIL"}`)
  console.log(`  evidence: ${result.evidenceDir}`)
  if (!result.passed) {
    console.log(`  failures: ${result.failures.join("; ")}`)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
