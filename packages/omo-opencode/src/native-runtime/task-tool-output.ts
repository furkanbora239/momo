import type { NativeTask, NativeTaskKind, NativeTaskRepository, NativeTaskRole } from "../native-task"
import { nativeAgentPermissions, nativeToolAllowed } from "./role-policy"

const previewLimit = 2048
const terminalStates = new Set(["succeeded", "failed", "cancelled"])
export type TaskPage = { offset?: number; limit?: number }

function bounded(value: string | undefined, limit = 512): string | undefined {
  if (value === undefined || Buffer.byteLength(value) <= limit) return value
  let end = Math.min(value.length, limit)
  while (end > 0 && Buffer.byteLength(value.slice(0, end)) > limit) end -= 1
  if (end > 0 && /[\uD800-\uDBFF]/.test(value[end - 1] ?? "")) end -= 1
  return value.slice(0, end)
}

export function rolePermissions(role: NativeTaskRole) {
  const agent = `momo-${role}` as Parameters<typeof nativeAgentPermissions>[0]
  const permissions = nativeAgentPermissions(agent)
  const allowed = (action: string) => permissions.some((permission) => permission.action === action && permission.effect === "allow")
  return { scope: "role_policy" as const, purpose: role === "worker" ? "Direct implementation with shell and editing" : nativeToolAllowed(agent, "momo_task") ? "Readonly coordination; delegate implementation to workers" : "Readonly investigation or consultation", canRead: true, canEdit: allowed("edit"), canShell: allowed("shell"), canDelegate: nativeToolAllowed(agent, "momo_task"), canConsult: nativeToolAllowed(agent, "momo_consult") }
}

export function compactTask(task: NativeTask, includeResult = true) {
  const terminal = terminalStates.has(task.state)
  const result = includeResult ? task.result : undefined
  const options = task.question?.options
  const optionsFit = options === undefined || Buffer.byteLength(JSON.stringify(options)) <= 2048
  return {
    id: task.id, kind: task.kind, state: task.state, decisionId: task.decisionId,
    rootTaskID: task.rootTaskID, parentTaskID: task.parentTaskID, sessionID: task.sessionID,
    role: task.role, model: task.model, rolePermissions: task.role === undefined ? undefined : rolePermissions(task.role),
    execution: { status: task.executionOutcome?.state ?? task.state, verification: "unknown" as const },
    createdAt: task.createdAt, updatedAt: task.updatedAt, attempts: task.attempts,
    activity: { progress: terminal ? undefined : bounded(task.progress), lastActivityAt: task.lastActivityAt, activeTools: terminal ? [] : task.activeTools.slice(0, 10).map((tool) => ({ name: bounded(tool.name, 128), startedAt: tool.startedAt })), activeToolCount: terminal ? 0 : task.activeTools.length },
    selection: { required: task.state === "awaiting_selection", candidateCount: task.state === "awaiting_selection" ? task.candidates?.length ?? 0 : 0 },
    error: task.state === "failed" || task.state === "awaiting_selection" ? bounded(task.error, 1024) : undefined,
    question: task.state === "waiting_question" && task.question ? { id: task.question.id, prompt: bounded(task.question.prompt, 1024), options: optionsFit ? options : undefined, requiresNativeForm: !optionsFit, escalated: task.questionEscalated } : undefined,
    childCount: task.childTaskIDs.length,
    result: bounded(result, previewLimit), resultLength: task.result?.length ?? 0,
    resultTruncated: result !== undefined && result !== bounded(result, previewLimit),
    resultInfo: task.result === undefined ? undefined : { available: true, length: task.result.length, truncated: includeResult && task.result !== bounded(result, previewLimit) },
  }
}

export async function taskForCaller(repository: NativeTaskRepository, taskID: string, callerSessionID: string, kind: NativeTaskKind): Promise<NativeTask> {
  const task = await repository.get(taskID)
  if (!task || task.kind !== kind) throw new Error(`No ${kind} exists with that task ID`)
  if (task.parentSessionID !== callerSessionID && task.rootSessionID !== callerSessionID) throw new Error("Task access is limited to its parent session and root session")
  return task
}

export async function listTasksForCaller(repository: NativeTaskRepository, callerSessionID: string, kind: NativeTaskKind, options: TaskPage & { includeMaintenance?: boolean }) {
  const owned = (await repository.list()).filter((task) => task.kind === kind && (task.parentSessionID === callerSessionID || task.rootSessionID === callerSessionID))
  const maintenance = (task: NativeTask) => task.sourceDecisionID !== undefined && task.requiredRole === "catalog-researcher"
  const all = owned.filter((task) => options.includeMaintenance || !maintenance(task)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const offset = options.offset ?? 0
  const limit = Math.min(options.limit ?? 10, 10)
  const page = all.slice(offset, offset + limit)
  return { tasks: page.map((task) => ({ id: task.id, kind: task.kind, state: task.state, decisionId: task.decisionId, role: task.role, model: task.model, parentTaskID: task.parentTaskID, createdAt: task.createdAt, prompt: bounded(task.prompt, 160), maintenance: maintenance(task) })), total: all.length, maintenanceCount: owned.filter(maintenance).length, offset, nextOffset: offset + page.length < all.length ? offset + page.length : undefined }
}

function modelFacts(value: unknown) {
  const facts = typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
  const number = (key: string) => typeof facts[key] === "number" ? facts[key] : undefined
  const string = (key: string) => typeof facts[key] === "string" ? bounded(facts[key], 256) : undefined
  return { toolCall: typeof facts.toolCall === "boolean" ? facts.toolCall : undefined, contextLength: number("contextLength"), inputPricePerMillion: number("inputPricePerMillion"), outputPricePerMillion: number("outputPricePerMillion"), priceCurrency: string("priceCurrency"), priceSource: string("priceSource") }
}

export function candidatePage(task: NativeTask, options: TaskPage & { role?: NativeTaskRole; providerID?: string }) {
  const all = task.state === "awaiting_selection" ? (task.candidates ?? []).filter((candidate) => (options.role === undefined || options.role === candidate.role) && (options.providerID === undefined || options.providerID === candidate.model.providerID)) : []
  const offset = options.offset ?? 0
  const page = all.slice(offset, offset + Math.min(options.limit ?? 10, 10))
  return { taskID: task.id, decisionId: task.decisionId, state: task.state, total: all.length, offset, nextOffset: offset + page.length < all.length ? offset + page.length : undefined, candidates: page.map((candidate) => ({ role: candidate.role, model: candidate.model, rolePermissions: rolePermissions(candidate.role), modelFacts: modelFacts(candidate.facts), probability: candidate.probability, rationale: bounded(candidate.rationale, 256) })) }
}

export function resultPage(task: NativeTask, options: TaskPage) {
  const offset = options.offset ?? 0
  const end = offset + Math.min(options.limit ?? 4096, 16384)
  const result = task.result?.slice(offset, end)
  return { taskID: task.id, state: task.state, verification: "unknown" as const, available: task.result !== undefined, result, offset, resultLength: task.result?.length ?? 0, nextOffset: task.result !== undefined && end < task.result.length ? end : undefined }
}

// Keys, IDs and option values are native answer protocol identifiers.
// An oversized schema must be answered through the complete native form.
function questionFields(task: NativeTask) {
  const fields = task.question?.form?.fields
  if (!Array.isArray(fields)) return { fields: undefined, count: 0, requiresNativeForm: false }
  const output = fields.map((field: unknown) => {
    if (typeof field !== "object" || field === null) return undefined
    const item = field as Record<string, unknown>
    const string = (key: string) => typeof item[key] === "string" ? item[key] : undefined
    return {
      ...item,
      key: string("key"), id: string("id"), type: string("type"),
      title: bounded(string("title"), 512), description: bounded(string("description"), 512),
      options: Array.isArray(item.options) ? item.options.map((option: unknown) => {
        if (typeof option === "string") return option
        if (typeof option !== "object" || option === null) return undefined
        const choice = option as Record<string, unknown>
        return { ...choice, value: typeof choice.value === "string" ? choice.value : undefined, label: typeof choice.label === "string" ? bounded(choice.label, 256) : undefined }
      }) : undefined,
    }
  })
  const requiresNativeForm = Buffer.byteLength(JSON.stringify(output)) > 8192
  return { fields: requiresNativeForm ? undefined : output, count: fields.length, requiresNativeForm }
}

export function taskDetail(task: NativeTask) {
  const schema = questionFields(task)
  const compact = compactTask(task)
  const prompt = bounded(task.prompt, 2048)
  const scope = bounded(task.scope, 1024)
  const acceptance = bounded(task.acceptance, 1024)
  return {
    ...compact, prompt, scope, acceptance,
    questionFieldCount: schema.count, questionFieldsTruncated: schema.requiresNativeForm,
    requiresNativeForm: schema.requiresNativeForm || compact.question?.requiresNativeForm === true, questionFields: schema.fields,
    detailTruncated: prompt !== task.prompt || scope !== task.scope || acceptance !== task.acceptance,
  }
}
