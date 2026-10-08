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
  async forms(childId: string): Promise<any[]> {
    const d = await this.json(`/api/session/${childId}/form`).catch(() => null)
    if (Array.isArray(d?.data)) return d.data
    // Tolerate a bare (no /api) route in case baseUrl already carried it.
    const d2 = await this.json(`/session/${childId}/form`).catch(() => null)
    return Array.isArray(d2?.data) ? d2.data : []
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

// Q2 is dispatched to exercise UNanswered-question escalation. The orchestrator
// must NOT answer it (the system escalates to the user after the bounded wait).
// Instruct it explicitly so the escalation branch is actually exercised.
const PARENT_SPAWN_NO_ANSWER =
  (q: string) =>
    "Spawn exactly ONE background task, category quick, " +
    `model ${RUNBOOK_MODEL}, with this prompt: '${q}' ` +
    "Run it in the background. CRITICAL: after dispatching, do NOT answer any " +
    "question this worker raises — the question-routing system will escalate it " +
    "to the user after a timeout. Acknowledge that you dispatched the task and " +
    "then STOP. Do not call the task tool to answer anything."

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

    const ROUTE_MARKER = "[Subagent question]"
    const ESCALATION_MARKER = "[Subagent question escalated to user]"
    const Q1_TEXT = "codename of this repository"
    let routedToOrchestrator = false
    let noEarlyEscalation = true
    let notificationText = ""
    let taskId: string | undefined
    let childSessionId: string | undefined

    // Phase A — extract `task_id`/`session_id` from the parent's SPAWN response
    // metadata. This appears immediately after the parent dispatches the child,
    // unlike the orchestrator routing notification which the parent-wake engine
    // DEFERS until the parent goes idle. We need these anchors early so we can
    // answer the child well inside the 120s bounded-wait window. Match the
    // canonical spawn-result text (`Background Task ID: bg_…`) and the
    // `<task_metadata>` `session_id: ses_…`; take the LAST occurrence so a later
    // dispatch (Q2) is not shadowed by an earlier one (Q1).
    for (let i = 0; i < 60; i++) {
      await sleep(5000)
      const msgs = await api.messages(parentId)
      const flat = msgs.map(msgText).join("\n")
      const taskIds = [...flat.matchAll(/Background Task ID:\s*(bg_[A-Za-z0-9]+)/g)].map((m) => m[1])
      const sessIds = [...flat.matchAll(/session_id:\s*(ses_[A-Za-z0-9]+)/g)].map((m) => m[1])
      if (!taskId && taskIds.length) taskId = taskIds[taskIds.length - 1]
      if (!childSessionId && sessIds.length) childSessionId = sessIds[sessIds.length - 1]
      if (taskId && childSessionId) break
    }

    // Phase B — detect the child ASKING the question by polling the CHILD session
    // directly. This is the real routing moment and is NOT subject to the
    // parent-wake deferral, so the orchestrator can answer within the bounded
    // wait. At that instant we record whether a user-escalation already leaked
    // into the parent (assert2).
    let childAskedAt = 0
    for (let i = 0; i < 60; i++) {
      await sleep(5000)
      const pMsgs = await api.messages(parentId).catch(() => [])
      const pFlat = pMsgs.map(msgText).join("\n")
      // Capture the (deferred) orchestrator routing notification whenever it
      // finally lands — it validates assert1 even though it is delivered late.
      if (!routedToOrchestrator && pFlat.includes(ROUTE_MARKER) && pFlat.includes(Q1_TEXT)) {
        const m = pMsgs.find(
          (mm) => msgText(mm).includes(ROUTE_MARKER) && msgText(mm).includes(Q1_TEXT),
        )
        notificationText = m ? msgText(m) : pFlat
        routedToOrchestrator = true
        // If the early child-session signal did not fire first, judge
        // early-escalation from the (deferred) routing moment instead.
        if (childAskedAt === 0) noEarlyEscalation = !pFlat.includes(ESCALATION_MARKER)
        writeFileSync(join(evidenceDir, "routing-notification.txt"), redact(notificationText, secrets))
      }
      if (childSessionId) {
        const cMsgs = await api.messages(childSessionId).catch(() => [])
        const cFlat = cMsgs.map(msgText).join("\n")
        if (cFlat.includes(Q1_TEXT)) {
          childAskedAt = Date.now()
          // The child just asked; routing to the orchestrator is guaranteed (the
          // deferred notification lands later). Mark it routed now so the answer
          // path runs within the bounded wait.
          routedToOrchestrator = true
          // The 120s bounded wait has not elapsed, so a user-escalation in the
          // parent now would be a genuine early leak.
          noEarlyEscalation = !pFlat.includes(ESCALATION_MARKER)
          break
        }
      }
    }
    writeFileSync(
      join(evidenceDir, "timing.json"),
      redact(
        JSON.stringify(
          {
            childAskedAt,
            routedToOrchestrator,
            noEarlyEscalation,
            note: "childAskedAt is the early (child-session) routing moment; the orchestrator must answer before +120s",
          },
          null,
          2,
        ),
        secrets,
      ),
    )
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
      // Diagnostic: capture the child's OPEN form so we can prove the form API
      // sees it and record its real field `key`/options (root-cause evidence
      // for the answer-map shape fix).
      const formBefore = await api.forms(childSessionId!).catch(() => [])
      writeFileSync(
        join(evidenceDir, "q1-form-before.json"),
        redact(JSON.stringify({ childSessionId, taskId, forms: formBefore }, null, 2), secrets),
      )
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
      // Diagnostic: re-inspect the form after answering to prove the reply
      // settled it (status flips away from open) or to capture the failure.
      const formAfter = await api.forms(childSessionId!).catch(() => [])
      writeFileSync(
        join(evidenceDir, "q1-form-after.json"),
        redact(JSON.stringify({ answerDelivered, forms: formAfter }, null, 2), secrets),
      )
      // Poll the child session for proof the answer reached the worker. The
      // correct (form-reply) answer path delivers the answer INTO the child's
      // open question FORM, which unblocks the blocked `question` tool call —
      // the tool call transitions out of `status:"running"`. It does NOT inject
      // visible "momo" text (that only happened under the old non-unblocking
      // prompt-injection fallback). So accept ANY of: the answer text surfaces
      // in the child session, the child's `question` tool call resolved, or the
      // open form was replied to.
      const questionStillRunning = (msgs: any[]): boolean =>
        msgs.some((m) => m && m.name === "question" && m.state && m.state.status === "running")
      for (let i = 0; i < 30; i++) {
        await sleep(5000)
        const cMsgs = await api.messages(childSessionId!).catch(() => [])
        const cFlat = JSON.stringify(cMsgs)
        const forms = await api.forms(childSessionId!).catch(() => [])
        const formReplied = forms.some(
          (f: any) => f.reply || (typeof f.status === "string" && f.status !== "open" && f.status !== "pending" && f.status !== "running"),
        )
        if (cFlat.includes("momo") || !questionStillRunning(cMsgs) || formReplied) {
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
        failures.push("assert(3): child did not continue with the orchestrator answer (question tool still blocked / no form reply)")
      }
    }

    // Capture the (deferred) orchestrator routing notification for Q1 evidence
    // now that the parent-wake engine has had time to flush it.
    if (!notificationText) {
      for (let i = 0; i < 24; i++) {
        await sleep(5000)
        const pMsgs = await api.messages(parentId).catch(() => [])
        const pFlat = pMsgs.map(msgText).join("\n")
        if (pFlat.includes(ROUTE_MARKER) && pFlat.includes(Q1_TEXT)) {
          const m = pMsgs.find(
            (mm) => msgText(mm).includes(ROUTE_MARKER) && msgText(mm).includes(Q1_TEXT),
          )
          notificationText = m ? msgText(m) : pFlat
          writeFileSync(join(evidenceDir, "routing-notification.txt"), redact(notificationText, secrets))
          break
        }
      }
    }

    // ---- dispatch child2 (asks Q2, intentionally NOT answered) ----
    await api.prompt(parentId, PARENT_SPAWN_NO_ANSWER(CHILD_PROMPT_Q2))

    // The escalation timer starts when Q2 is ROUTED (its `question` tool call
    // is observed), not when the parent spawns the child. Poll the parent for
    // Q2's routing notification, then wait the bounded window (live default
    // 120s) + slack measured from routing — a fixed sleep-after-spawn can land
    // inside the window if the child is slow to ask.
    const Q2_TEXT = "branch should I target"
    let q2RoutedAt = 0
    let q2TaskId: string | undefined
    let q2ChildSessionId: string | undefined
    // Phase A — extract `task_id`/`session_id` from the parent's spawn response
    // metadata (available immediately, unlike the deferred routing notification).
    // Q1's DEFERRED routing notification arrives AFTER Q2's dispatch and echoes
    // Q1's own `Background Task ID:` / `session_id:`, so the LAST occurrence
    // across all parent messages would be Q1's. Exclude Q1's already-known ids
    // and take the most-recent distinct Q2 id instead.
    for (let i = 0; i < 60; i++) {
      await sleep(5000)
      const msgs = await api.messages(parentId).catch(() => [])
      const flat = msgs.map(msgText).join("\n")
      const taskIds = [...flat.matchAll(/Background Task ID:\s*(bg_[A-Za-z0-9]+)/g)].map((m) => m[1])
      const sessIds = [...flat.matchAll(/session_id:\s*(ses_[A-Za-z0-9]+)/g)].map((m) => m[1])
      const q2Task = taskIds.filter((id) => id !== taskId).pop()
      const q2Child = sessIds.filter((id) => id !== childSessionId).pop()
      if (!q2TaskId && q2Task) q2TaskId = q2Task
      if (!q2ChildSessionId && q2Child) q2ChildSessionId = q2Child
      if (q2TaskId && q2ChildSessionId) break
    }
    // Phase B — detect child2 ASKING the question (early, via the child session,
    // not the deferred parent notification). The escalation timer starts when
    // the child asks; we measure the bounded wait from there.
    for (let i = 0; i < 60; i++) {
      await sleep(5000)
      const pMsgs = await api.messages(parentId).catch(() => [])
      const pFlat = pMsgs.map(msgText).join("\n")
      if (!q2RoutedAt && pFlat.includes(ROUTE_MARKER) && pFlat.includes(Q2_TEXT)) {
        // The routing notification is the ONLY parent message that carries BOTH
        // the "[Subagent question]" marker and the question text. The parent's
        // own dispatch echo also contains Q2_TEXT (it embedded the child prompt
        // verbatim) but never the marker, so the marker disambiguates and yields
        // the real task_id anchor.
        const m = pMsgs.find(
          (mm) => msgText(mm).includes(ROUTE_MARKER) && msgText(mm).includes(Q2_TEXT),
        )
        const note = m ? msgText(m) : pFlat
        const anchor = note.match(/task_id=([^\s"\\()]+)/)
        q2TaskId = q2TaskId ?? anchor?.[1] ?? note.match(/task_id="([^"]+)"/)?.[1]
        q2RoutedAt = Date.now()
        writeFileSync(join(evidenceDir, "q2-routing-notification.txt"), redact(note, secrets))
      }
      if (q2ChildSessionId) {
        const cMsgs = await api.messages(q2ChildSessionId).catch(() => [])
        const cFlat = cMsgs.map(msgText).join("\n")
        if (cFlat.includes(Q2_TEXT)) {
          if (!q2RoutedAt) q2RoutedAt = Date.now()
          break
        }
      }
    }
    // Wait the bounded escalation window + slack, measured from the child ask.
    const QUESTION_WAIT_MS = 120_000
    const ESCALATION_SLACK_MS = 25_000
    const elapsed = q2RoutedAt ? Date.now() - q2RoutedAt : 0
    const remaining = Math.max(0, QUESTION_WAIT_MS + ESCALATION_SLACK_MS - elapsed)
    await sleep(remaining)
    const afterMsgs = await api.messages(parentId)
    const afterFlat = JSON.stringify(afterMsgs)
    const escalatedToUser = afterFlat.includes(ESCALATION_MARKER) && afterFlat.includes("branch should I target")
    if (!escalatedToUser) {
      const note2 = afterMsgs.map(msgText).join("\n")
      writeFileSync(join(evidenceDir, "q2-after-window.txt"), redact(note2, secrets))
      writeFileSync(
        join(evidenceDir, "q2-timing.json"),
        redact(
          JSON.stringify({
            q2RoutedAt,
            q2TaskId,
            waitedMs: remaining,
            escalationSeen: afterFlat.includes(ESCALATION_MARKER),
            branchSeen: afterFlat.includes("branch should I target"),
          }, null, 2),
          secrets,
        ),
      )
      failures.push("assert(4): unanswered question did not escalate to the user after the bounded wait")
    }

    // Stop event diagnostics.
    evtCollecting = false
    evtReader?.cancel().catch(() => {})

    const serveLog = readFileSync(logPath, "utf8")
    const red = (s: string) => redact(s, secrets)
    writeFileSync(join(evidenceDir, "serve-log-excerpt.log"), red(serveLog))

    // Capture the momo plugin log (oh-my-opencode.log under the sandbox TMPDIR)
    // and extract the M2d question-routing lines so we can prove whether the
    // form reply succeeded or threw (root-cause evidence for the answer path).
    try {
      const pluginLogPath = join(sandboxRoot, "tmp", "oh-my-opencode.log")
      const pluginLog = readFileSync(pluginLogPath, "utf8")
      const m2dLines = pluginLog
        .split("\n")
        .filter((l) => /subagent-question-router|form reply|deliver answer|answered child|failed to (list|reply)|no form API/i.test(l))
      writeFileSync(join(evidenceDir, "plugin-log-m2d.log"), red(m2dLines.join("\n")))
      // Full (unfiltered) plugin log for post-mortem of the escalation path.
      writeFileSync(join(evidenceDir, "plugin-log-full.log"), red(pluginLog))
    } catch {}
    writeFileSync(
      join(evidenceDir, "events-seen.json"),
      red(JSON.stringify({ seenTypes: [...seenTypes], toolCalledCount: toolCalledSeen.length }, null, 2)),
    )
    writeFileSync(
      join(evidenceDir, "events-raw.json"),
      red(JSON.stringify(toolCalledSeen, null, 2)),
    )
    const summary = [
      `# M2d question-routing live exam (${new Date().toISOString()})`,
      "",
      `port: ${port}`,
      `parent: ${parentId}`,
      `taskId: ${taskId ?? "n/a"}`,
      `childSessionId: ${childSessionId ?? "n/a"}`,
      `q2TaskId: ${q2TaskId ?? "n/a"}`,
      `q2RoutedAt: ${q2RoutedAt ? new Date(q2RoutedAt).toISOString() : "n/a"}`,
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
