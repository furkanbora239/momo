import { createHash } from "node:crypto"
import type { FormFields, SessionInfo, V2Event } from "@opencode/client"
import type { NativeTask, NativeTaskEvent, NativeTaskQuestion, NativeTaskRepository, NativeTaskRole, NativeTaskRuntime } from "../native-task/types"
import { discoverNativeV2Client, type NativeV2Client } from "./v2-service-client"

type NativeSessionMetadata = {
  version: 1
  taskID: string
  rootSessionID: string
  parentSessionID: string
  role: NativeTaskRole
  model: { providerID: string; id: string }
}

export type NativeSessionRuntime = NativeTaskRuntime & {
  onFormEvent(event: V2Event): Promise<boolean>
}

export function createNativeSessionRuntime(input: {
  client?: NativeV2Client
  repository: NativeTaskRepository
  resolveOwnedRole: (session: SessionInfo) => NativeTaskRole | undefined
  resolveOwnedAgentID: (role: NativeTaskRole) => string | undefined
  verifySessionOwner: (session: SessionInfo) => Promise<void>
  onParentAnswer?: (taskID: string, questionID: string, answer: unknown, replyingSessionID: string) => Promise<void>
  onEvent?: (event: NativeTaskEvent) => Promise<void>
}): NativeSessionRuntime {
  let clientPromise: Promise<NativeV2Client> | undefined
  const client = () => {
    clientPromise ??= input.client === undefined ? discoverNativeV2Client() : Promise.resolve(input.client)
    return clientPromise
  }

  async function resolveCaller(sessionID: string): Promise<{ role: NativeTaskRole; rootSessionID: string }> {
    const session = await ownedSession(sessionID)
    const metadata = readNativeMetadata(session.metadata?.momoNativeTask)
    if (metadata !== undefined) {
      const task = await input.repository.get(metadata.taskID)
      if (task === undefined || task.sessionID !== session.id || task.role !== metadata.role || task.rootSessionID !== metadata.rootSessionID || task.parentSessionID !== metadata.parentSessionID) {
        throw new Error("OpenCode child session metadata does not match the durable native task record")
      }
      const role = input.resolveOwnedRole(session)
      if (role !== metadata.role) throw new Error("OpenCode child session role does not match its durable assignment")
      return { role, rootSessionID: metadata.rootSessionID }
    }
    if (session.parentID !== undefined) throw new Error("Untracked OpenCode child sessions cannot create native tasks")
    const role = input.resolveOwnedRole(session)
    if (role === undefined) throw new Error("Only sessions running an installed momo agent can create native tasks")
    return { role, rootSessionID: session.id }
  }

  async function createSession(args: Parameters<NativeTaskRuntime["createSession"]>[0]): Promise<{ sessionID: string }> {
    const api = await client()
    const sessionID = stableID("ses", args.taskID, 26)
    const agentID = input.resolveOwnedAgentID(args.role)
    if (agentID === undefined) throw new Error(`No installed momo agent is registered for role ${args.role}`)
    const expected: NativeSessionMetadata = {
      version: 1,
      taskID: args.taskID,
      rootSessionID: args.rootSessionID,
      parentSessionID: args.parentSessionID,
      role: args.role,
      model: args.model,
    }
    const existing = await findSession(api, sessionID)
    if (existing !== undefined) {
      await input.verifySessionOwner(existing)
      const parent = await ownedSession(args.parentSessionID)
      if (!sameMetadata(readNativeMetadata(existing.metadata?.momoNativeTask), expected) || existing.parentID !== args.parentSessionID || existing.agent !== agentID || !sameModel(existing.model, args.model) || existing.projectID !== parent.projectID || existing.location.directory !== parent.location.directory) {
        throw new Error("Deterministic OpenCode session ID is already owned by another task")
      }
      return { sessionID: existing.id }
    }
    const parent = await ownedSession(args.parentSessionID)
    const created = await api.session.create({
      id: sessionID,
      parentID: args.parentSessionID,
      title: `momo task ${args.taskID}`,
      agent: agentID,
      model: { providerID: args.model.providerID, id: args.model.id },
      location: { directory: parent.location.directory },
      metadata: { momoNativeTask: expected },
    })
    if (created.id !== sessionID || created.parentID !== args.parentSessionID || created.agent !== agentID || !sameModel(created.model, args.model) || created.projectID !== parent.projectID || created.location.directory !== parent.location.directory) {
      throw new Error("OpenCode child session does not match its durable task assignment")
    }
    return { sessionID: created.id }
  }

  async function start(args: Parameters<NativeTaskRuntime["start"]>[0]): Promise<void> {
    await ownedSession(args.sessionID)
    const task = await findTaskBySession(input.repository, args.sessionID)
    const messageID = stableID("msg", `start:${task.id}`, 26)
    launchPrompt(await client(), args.sessionID, args.prompt, messageID, onLaunchError)
  }

  async function resume(args: Parameters<NativeTaskRuntime["resume"]>[0]): Promise<void> {
    const task = await input.repository.get(args.taskID)
    if (task === undefined || task.sessionID !== args.sessionID) throw new Error("Cannot resume an unknown native task session")
    await ownedSession(args.sessionID)
    const messageID = stableID("msg", `resume:${task.id}:${task.attempts}`, 26)
    launchPrompt(await client(), args.sessionID, `Resume the existing task from its current session state. Continue the same work and report the result.`, messageID, onLaunchError)
  }

  async function inspect(sessionID: string): Promise<Awaited<ReturnType<NativeTaskRuntime["inspect"]>>> {
    const api = await client()
    try {
      await ownedSession(sessionID)
      const [active, session, messages] = await Promise.all([
        api.session.active(),
        api.session.get({ sessionID }),
        api.session.context({ sessionID }),
      ])
      const usage = sessionUsage(session)
      if (active[sessionID] !== undefined) return { state: "running", ...(usage !== undefined ? { usage } : {}) }
      const result = resultFromMessages(messages)
      if (session.outcome === "succeeded") return { state: "succeeded", result: result.text, ...(usage !== undefined ? { usage } : {}) }
      if (session.outcome === "failed") return { state: "failed", error: result.error, result: result.text, ...(usage !== undefined ? { usage } : {}) }
      if (session.outcome === "interrupted") return { state: "interrupted", ...(usage !== undefined ? { usage } : {}) }
      if (result.completed) {
        if (result.error !== undefined) return { state: "failed", error: result.error, result: result.text, ...(usage !== undefined ? { usage } : {}) }
        return { state: "succeeded", result: result.text, ...(usage !== undefined ? { usage } : {}) }
      }
      return { state: "idle", ...(usage !== undefined ? { usage } : {}) }
    } catch (error) {
      if (isNotFound(error)) return { state: "missing" }
      throw error
    }
  }

  async function interrupt(args: Parameters<NativeTaskRuntime["interrupt"]>[0]): Promise<void> {
    await ownedSession(args.sessionID)
    await (await client()).session.interrupt({ sessionID: args.sessionID })
  }

  async function deliver(args: Parameters<NativeTaskRuntime["deliver"]>[0]): Promise<void> {
    const task = await input.repository.get(args.taskID)
    if (task === undefined || task.parentSessionID !== args.parentSessionID) throw new Error("Cannot deliver a result for an unknown native task parent")
    await ownedSession(args.parentSessionID)
    const messageID = stableID("msg", `delivery:${args.taskID}`, 26)
    await (await client()).session.synthetic({
      sessionID: args.parentSessionID,
      id: messageID,
      text: args.result,
      description: `Native task ${args.taskID} result`,
      metadata: { momoNativeDelivery: { taskID: args.taskID, messageID } },
      delivery: "queue",
      resume: task.parentSessionID === task.rootSessionID,
    })
  }

  async function ask(args: Parameters<NativeTaskRuntime["ask"]>[0]): Promise<void> {
    await ownedSession(args.parentSessionID)
    await createQuestionForm(await client(), args.parentSessionID, args.taskID, args.question, "question")
  }

  async function escalateQuestion(args: Parameters<NativeTaskRuntime["escalateQuestion"]>[0]): Promise<void> {
    await ownedSession(args.rootSessionID)
    await createQuestionForm(await client(), args.rootSessionID, args.taskID, args.question, "escalation")
  }

  async function answer(args: Parameters<NativeTaskRuntime["answer"]>[0]): Promise<void> {
    const api = await client()
    await ownedSession(args.sessionID)
    const form = await api.session.form.get({ sessionID: args.sessionID, formID: args.questionID })
    await api.session.form.reply({
      sessionID: args.sessionID,
      formID: args.questionID,
      answer: normalizeAnswer(args.answer, form.fields),
    })
  }

  async function continueParent(args: Parameters<NativeTaskRuntime["continueParent"]>[0]): Promise<void> {
    await ownedSession(args.sessionID)
    const messageID = stableID("msg", `children-wake:${args.taskID}:${args.wakeID ?? args.message}`, 26)
    launchPrompt(await client(), args.sessionID, args.message, messageID, onLaunchError)
  }

  async function onFormEvent(event: V2Event): Promise<boolean> {
    if (event.type === "form.created") return isForwardedForm(event.data.form.metadata)
    if (event.type !== "form.replied") return false
    const api = await client()
    await ownedSession(event.data.sessionID)
    const form = await api.session.form.get({ sessionID: event.data.sessionID, formID: event.data.id })
    const metadata = asRecord(form.metadata)
    const kind = metadata?.momoNativeFormKind
    if (metadata === undefined || (kind !== "question" && kind !== "escalation")) return false
    if (typeof metadata.momoNativeTaskID !== "string" || typeof metadata.momoNativeQuestionID !== "string") return true
    const task = await input.repository.get(metadata.momoNativeTaskID)
    if (task === undefined || task.sessionID === undefined || task.question?.id !== metadata.momoNativeQuestionID) return true
    const expectedParent = kind === "escalation" ? task.rootSessionID : task.parentSessionID
    if (expectedParent !== event.data.sessionID || (kind === "escalation" && task.questionEscalated !== true)) return true
    if (input.onParentAnswer === undefined) throw new Error("Native task answer callback is not wired")
    await input.onParentAnswer(task.id, task.question.id, event.data.answer, event.data.sessionID)
    return true
  }

  async function ownedSession(sessionID: string): Promise<SessionInfo> {
    const session = await (await client()).session.get({ sessionID })
    await input.verifySessionOwner(session)
    return session
  }

  async function onLaunchError(sessionID: string, error: unknown): Promise<void> {
    const detail = error instanceof Error ? error.message : String(error)
    await input.onEvent?.({ id: stableID("evt", `launch-error:${sessionID}:${detail}`, 26), type: "execution.failed", sessionID, error: detail })
  }

  return {
    resolveCaller,
    createSession,
    start,
    inspect,
    resume,
    interrupt,
    deliver,
    ask,
    escalateQuestion,
    answer,
    continueParent,
    onFormEvent,
  }
}

function isForwardedForm(value: unknown): boolean {
  const metadata = asRecord(value)
  return metadata?.momoNativeFormKind === "question" || metadata?.momoNativeFormKind === "escalation"
}

function launchPrompt(api: NativeV2Client, sessionID: string, prompt: string, messageID: string, onError: (sessionID: string, error: unknown) => Promise<void>): void {
  try {
    void api.session.prompt({
      sessionID,
    id: messageID,
    text: prompt,
    delivery: "queue",
    }).catch((error: unknown) => onError(sessionID, error))
  } catch (error) {
    void onError(sessionID, error)
  }
}

async function findSession(api: NativeV2Client, sessionID: string): Promise<SessionInfo | undefined> {
  try {
    return await api.session.get({ sessionID })
  } catch (error) {
    if (isNotFound(error)) return undefined
    throw error
  }
}

async function findTaskBySession(repository: NativeTaskRepository, sessionID: string): Promise<NativeTask> {
  const task = (await repository.list()).find((candidate) => candidate.sessionID === sessionID)
  if (task === undefined) throw new Error("Cannot start an OpenCode session without a durable native task record")
  return task
}

async function createQuestionForm(api: NativeV2Client, sessionID: string, taskID: string, question: NativeTaskQuestion, kind: "question" | "escalation"): Promise<void> {
  const questionID = question.id
  const formID = stableID("frm", `${kind}:${taskID}:${questionID}`, 24)
  const existing = await api.session.form.list({ sessionID })
  if (existing.some((form) => form.id === formID)) return
  const metadata = {
    momoNativeFormKind: kind,
    momoNativeTaskID: taskID,
    momoNativeQuestionID: questionID,
    momoNativeFormID: formID,
  }
  await api.session.form.create({
    sessionID,
    id: formID,
    title: question.prompt,
    fields: formFields(question.form),
    metadata,
  })
}

function formFields(value: unknown): FormFields {
  const fields = asRecord(value)?.fields
  if (Array.isArray(fields) && fields.length > 0) return fields as FormFields
  return [{ key: "answer", title: "Answer", type: "string", required: true }]
}

function normalizeAnswer(value: unknown, fields: FormFields): Record<string, string | number | boolean | string[]> {
  const input = asRecord(value)
  const result: Record<string, string | number | boolean | string[]> = {}
  if (input !== undefined) {
    for (const field of fields) {
      const answer = input[field.key]
      if (isAnswerValue(answer)) result[field.key] = answer
    }
    return result
  }
  if (fields.length === 1 && isAnswerValue(value)) result[fields[0].key] = value
  return result
}

function isAnswerValue(value: unknown): value is string | number | boolean | string[] {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" || (Array.isArray(value) && value.every((item) => typeof item === "string"))
}

function resultFromMessages(messages: Awaited<ReturnType<NativeV2Client["session"]["context"]>>): { completed: boolean; text: string; error?: string } {
  const latest = [...messages].reverse().find((message) => message.type === "assistant")
  if (latest?.type !== "assistant" || latest.time.completed === undefined) return { completed: false, text: "" }
  const text = latest.content.filter((part) => part.type === "text").map((part) => part.text).join("")
  const error = latest.error === undefined ? undefined : JSON.stringify(latest.error)
  return { completed: true, text, ...(error !== undefined ? { error } : {}) }
}

function sessionUsage(session: SessionInfo): { inputTokens: number; outputTokens: number; scope: "session_cumulative" } | undefined {
  const inputTokens = session.tokens.input
  const outputTokens = session.tokens.output
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens) || (inputTokens === 0 && outputTokens === 0)) return undefined
  return { inputTokens, outputTokens, scope: "session_cumulative" }
}

function readNativeMetadata(value: unknown): NativeSessionMetadata | undefined {
  const record = asRecord(value)
  if (record?.version !== 1 || typeof record.taskID !== "string" || typeof record.rootSessionID !== "string" || typeof record.parentSessionID !== "string" || !isRole(record.role) || !isModel(record.model)) return undefined
  return { version: 1, taskID: record.taskID, rootSessionID: record.rootSessionID, parentSessionID: record.parentSessionID, role: record.role, model: record.model }
}

function sameMetadata(actual: NativeSessionMetadata | undefined, expected: NativeSessionMetadata): boolean {
  return actual !== undefined && JSON.stringify(actual) === JSON.stringify(expected)
}

function isModel(value: unknown): value is { providerID: string; id: string } {
  const record = asRecord(value)
  return typeof record?.providerID === "string" && typeof record.id === "string"
}

function sameModel(actual: SessionInfo["model"], expected: { providerID: string; id: string }): boolean {
  return actual?.providerID === expected.providerID && actual.id === expected.id
}

function isRole(value: unknown): value is NativeTaskRole {
  return value === "orchestrator" || value === "planner" || value === "executor" || value === "reviewer" || value === "worker" || value === "explore" || value === "librarian" || value === "research" || value === "catalog-researcher" || value === "advisor"
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function isNotFound(error: unknown): boolean {
  const record = asRecord(error)
  const message = error instanceof Error ? error.message : String(error)
  return record?.status === 404 || record?.statusCode === 404 || /session not found|not found.*session|form not found/i.test(message)
}

function stableID(prefix: string, source: string, length: number): string {
  const hex = createHash("sha256").update(source).digest("hex")
  return `${prefix}_${hex.slice(0, length)}`
}
