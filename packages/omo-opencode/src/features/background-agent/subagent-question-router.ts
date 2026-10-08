import { log } from "../../shared"

/**
 * M2d — question routing for delegated subagents.
 *
 * A worker (child background session) calling the native `question` /
 * `ask_user_question` tool surfaces only to the end user today. These helpers
 * add a routing target so the question first reaches the orchestrator (parent
 * session) which can answer it via the existing task continuation path
 * (`task(task_id, answer)` -> `BackgroundManager.resume`). If the orchestrator
 * does not answer within a bounded window the question escalates to the end user
 * exactly as before.
 *
 * Routing target resolution:
 *  - `orchestrator` (default): the asking session is a tracked subagent that has
 *    a parent session. The question is streamed to the parent as a notification.
 *  - `user` (explicit escalation): the question is left untouched so OpenCode
 *    presents the native dialog byte-for-byte as today.
 */

export type QuestionRouteTarget = "orchestrator" | "user"

export type QuestionOption = {
  label: string
  description?: string
}

export type RoutedQuestion = {
  question: string
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
}

export type PendingQuestion = {
  childSessionId: string
  taskId: string
  parentSessionId: string
  questions: RoutedQuestion[]
  route: QuestionRouteTarget
  askedAt: number
  answered: boolean
  escalated: boolean
}

export type QuestionRouteResult = {
  routed: QuestionRouteTarget
  taskId?: string
  parentSessionId?: string
  pending?: PendingQuestion
}

/** Bounded wait for the orchestrator to answer before escalating to the user. */
export const DEFAULT_QUESTION_ORCHESTRATOR_WAIT_MS = 120_000

const QUESTION_TOOL_NAMES = new Set(["question", "ask_user_question", "askuserquestion"])

export function isQuestionTool(toolName: string): boolean {
  return QUESTION_TOOL_NAMES.has(toolName.toLowerCase())
}

/**
 * A subagent may request explicit user escalation by passing `route: "user"` in
 * the question tool args (OpenCode forwards unknown args through). Any value
 * other than the explicit `"user"` resolves to the default orchestrator route.
 */
export function resolveQuestionRouteTarget(args: Record<string, unknown>): QuestionRouteTarget {
  const raw = typeof args.route === "string" ? args.route.toLowerCase() : ""
  if (raw === "user") {
    return "user"
  }
  return "orchestrator"
}

export function parseQuestionArgs(args: Record<string, unknown>): RoutedQuestion[] {
  const questions = args.questions
  if (Array.isArray(questions)) {
    return questions
      .filter((q): q is Record<string, unknown> => typeof q === "object" && q !== null)
      .map((q) => {
        const options = Array.isArray(q.options)
          ? q.options
            .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null)
            .map((o) => ({
              label: typeof o.label === "string" ? o.label : "",
              ...(typeof o.description === "string" ? { description: o.description } : {}),
            }))
          : undefined
        return {
          question: typeof q.question === "string" ? q.question : "",
          ...(typeof q.header === "string" ? { header: q.header } : {}),
          ...(options ? { options } : {}),
          ...(typeof q.multiSelect === "boolean" ? { multiSelect: q.multiSelect } : {}),
        }
      })
  }

  // Legacy single-question shape.
  const single: Record<string, unknown> =
    typeof args.question === "string"
      ? { question: args.question }
      : {}
  if (typeof args.header === "string") {
    single.header = args.header
  }
  if (Array.isArray(args.options)) {
    const options = (args.options as unknown[])
      .filter((o): o is Record<string, unknown> => typeof o === "object" && o !== null)
      .map((o) => ({
        label: typeof o.label === "string" ? o.label : "",
        ...(typeof o.description === "string" ? { description: o.description } : {}),
      }))
    single.options = options
  }
  if (typeof args.multiSelect === "boolean") {
    single.multiSelect = args.multiSelect
  }
  if (typeof single.question !== "string") {
    return []
  }
  return [single as RoutedQuestion]
}

export function buildChildQuestionNotificationText(pending: PendingQuestion): string {
  const lines: string[] = []
  lines.push("[Subagent question] A delegated worker is asking the orchestrator before escalating to the user.")
  lines.push("")
  const anchor = `task_id=${pending.taskId} session_id=${pending.childSessionId}`
  lines.push(`Answer with the task continuation tool: task(task_id="${pending.taskId}", answer="<your answer>").`)
  lines.push("")
  pending.questions.forEach((q, index) => {
    if (q.header) {
      lines.push(`${index + 1}. ${q.header}`)
    }
    lines.push(`   ${q.question}`)
    if (q.options && q.options.length > 0) {
      for (const option of q.options) {
        const suffix = option.description ? ` - ${option.description}` : ""
        lines.push(`     - ${option.label}${suffix}`)
      }
    }
    lines.push("")
  })
  lines.push(`(Context anchor: ${anchor})`)
  return lines.join("\n")
}

export function buildChildQuestionAnswerPrompt(answer: string, pending: PendingQuestion): string {
  const joined = pending.questions.map((q) => q.question).join(" | ")
  return [
    "ORCHESTRATOR ANSWER to your pending question.",
    `Original question: ${joined}`,
    "",
    `Answer: ${answer}`,
    "",
    "Continue the task using this answer.",
  ].join("\n")
}

export function buildUserEscalationNotificationText(pending: PendingQuestion): string {
  const lines: string[] = []
  lines.push("[Subagent question escalated to user] The orchestrator did not answer in time.")
  lines.push("")
  pending.questions.forEach((q, index) => {
    if (q.header) {
      lines.push(`${index + 1}. ${q.header}`)
    }
    lines.push(`   ${q.question}`)
    if (q.options && q.options.length > 0) {
      for (const option of q.options) {
        const suffix = option.description ? ` - ${option.description}` : ""
        lines.push(`     - ${option.label}${suffix}`)
      }
    }
    lines.push("")
  })
  return lines.join("\n")
}

/**
 * M2d — answer delivery via the OpenCode form API.
 *
 * When a worker (child background session) calls the native `question` /
 * `ask_user_question` tool, OpenCode opens a FORM (not a chat prompt) and blocks
 * the tool call until the form is replied. Injecting a plain prompt part is
 * dropped by the async-gate reservation for the blocked child and never resolves
 * the form, so the orchestrator's answer never reaches the child. Replying to the
 * open form directly unblocks the pending `question` call.
 */

export interface SessionFormField {
  /** OpenCode keys form fields by `key` (the schema field name), not `id`. */
  key?: string
  /** Legacy/alias key used by older callers and unit fixtures. */
  id?: string
  type?: string
  /** OpenCode sets `custom: true` on free-text (string) fields that accept any text. */
  custom?: boolean
  options?: Array<{ value: string; label?: string }>
}

export interface SessionForm {
  id: string
  status?: string
  fields?: SessionFormField[]
}

export interface FormApi {
  list(sessionId: string): Promise<SessionForm[]>
  reply(sessionId: string, formId: string, answer: Record<string, unknown>): Promise<void>
}

/**
 * Map an orchestrator's free-text answer onto the open form's field keys.
 *
 * OpenCode keys form fields `q0`, `q1`, ... For a single (non multiSelect)
 * question the field type is `"string"` with `custom: true` and accepts the raw
 * answer text. For `"multiselect"` fields the reply must be an array of matching
 * option values; when the orchestrator's answer does not name a known option we
 * fall back to the first option so the form still resolves.
 */
export function buildFormAnswerMap(
  fields: SessionFormField[] | undefined,
  answer: string,
): Record<string, unknown> {
  const map: Record<string, unknown> = {}
  const lower = answer.toLowerCase()
  for (const field of fields ?? []) {
    // OpenCode form fields carry `key`; honor the legacy `id` alias too so
    // older callers and unit fixtures keep working.
    const key = field.key ?? field.id
    if (!key) continue
    if (field.type === "multiselect") {
      const options = field.options ?? []
      const matched = options.filter((option) => {
        const label = (option.label ?? option.value ?? "").toLowerCase()
        return label.length > 0 && lower.includes(label)
      })
      map[key] = matched.length > 0
        ? matched.map((option) => option.value)
        : (options.length > 0 ? [options[0].value] : [])
      continue
    }
    map[key] = answer
  }
  return map
}

export function describeRouteResult(result: QuestionRouteResult): void {
  log("[subagent-question-router] route result:", {
    routed: result.routed,
    taskId: result.taskId,
    parentSessionId: result.parentSessionId,
  })
}

/** Minimal shape of the OpenCode event-subscription API used by M2d. */
export interface QuestionEventApi {
  subscribe(opts: { signal?: AbortSignal }): Promise<AsyncIterable<unknown>>
}

/**
 * Extract the session id, tool name, and raw args from a delegated subagent's
 * question tool call. Tolerant of every event shape OpenCode actually emits:
 *
 *  - V1 `tool.execute.before`  -> `{ properties: { sessionID, tool, args } }`
 *  - V2 `session.tool.called`  -> `{ data: { sessionID, input: { questions, route }, executed } }`
 *    (no `tool` name field; the question tool is discriminated by `input.questions`)
 *  - V2 `session.tool.input.started` -> `{ data: { sessionID, name: "question" } }`
 *  - V2 `session.tool.input.ended`   -> `{ data: { sessionID, text: "<json args>" } }`
 *
 * Returns undefined for unrelated events.
 */
export function parseChildQuestionEvent(event: unknown): {
  sessionID: string
  tool: string
  args: Record<string, unknown>
} | undefined {
  if (!event || typeof event !== "object") {
    return undefined
  }
  const record = event as Record<string, unknown>
  const data = (record.data ?? record.properties) as Record<string, unknown> | undefined
  if (!data || typeof data !== "object") {
    return undefined
  }

  const sessionID =
    typeof data.sessionID === "string"
      ? data.sessionID
      : (typeof record.sessionID === "string" ? record.sessionID : undefined)
  if (!sessionID) {
    return undefined
  }

  // Tool name comes from `data.name` (session.tool.input.started), `data.tool`,
  // a nested `input.tool`, or a top-level `record.tool`. It is empty for
  // `session.tool.called`, which is discriminated by its `input.questions`.
  const tool =
    typeof data.name === "string"
      ? data.name
      : (typeof data.tool === "string"
        ? data.tool
        : (typeof (data.input as Record<string, unknown> | undefined)?.tool === "string"
          ? ((data.input as Record<string, unknown>).tool as string)
          : (typeof record.tool === "string" ? record.tool : "")))

  // Args resolution, by descending precedence:
  //  1. `data.input` when it is a question-args object (has `questions`/`question`)
  //     — the live `session.tool.called` shape. It is NOT used when `data.input`
  //     is merely a tool descriptor (e.g. `{ tool: "..." }`).
  //  2. a JSON `data.text` — the live `session.tool.input.ended` shape.
  //  3. the V1 `args` / `output.args` / `input.args` fallbacks.
  let args: Record<string, unknown> | undefined
  const dataInput = data.input as Record<string, unknown> | undefined
  const inputLooksLikeQuestionArgs =
    !!dataInput
    && typeof dataInput === "object"
    && (Array.isArray(dataInput.questions) || typeof dataInput.question === "string")
  if (inputLooksLikeQuestionArgs) {
    args = dataInput
  } else if (typeof data.text === "string") {
    try {
      const parsed = JSON.parse(data.text)
      if (parsed && typeof parsed === "object") {
        args = parsed as Record<string, unknown>
      }
    } catch {
      args = undefined
    }
  }
  if (!args || typeof args !== "object") {
    args =
      (data.args as Record<string, unknown> | undefined)
      ?? ((data.output as Record<string, unknown> | undefined)?.args as Record<string, unknown> | undefined)
      ?? ((record.input as Record<string, unknown> | undefined)?.args as Record<string, unknown> | undefined)
      ?? {}
  }

  return { sessionID, tool, args }
}
