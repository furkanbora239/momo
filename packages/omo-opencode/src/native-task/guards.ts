import { mayCreateChildRole, mayCreateTask, isValidRoutedRole } from "./policy"
import type { NativeModelRef, NativeRouteResult, NativeTask, NativeTaskEngineOptions, NativeTaskKind, NativeTaskRole } from "./types"

export function applyRoute(task: NativeTask, result: NativeRouteResult): void {
  task.routeStatus = "routed"
  if (result.kind === "awaiting_selection") {
    task.state = "awaiting_selection"
    task.decisionId = result.decisionId
    task.candidates = result.candidates
    task.error = result.reason
    return
  }
  if (result.kind === "unavailable") {
    task.state = "failed"
    task.error = result.reason
    task.result = `Task could not be routed: ${result.reason}`
    task.delivery = { status: "pending", attempts: 0 }
    return
  }
  const permitted = task.requiredRole !== undefined
    ? result.role === task.requiredRole
    : task.kind === "consultation"
    ? task.parentRole !== "advisor" && result.role === "advisor"
    : isValidRoutedRole(task.kind, result.role) && mayCreateChildRole(task.parentRole, result.role)
  if (!permitted) {
    task.state = "failed"
    task.error = `Routing policy rejected role ${result.role} for ${task.parentRole}.`
    task.result = task.error
    task.delivery = { status: "pending", attempts: 0 }
    return
  }
  task.state = "queued"
  task.role = result.role
  task.model = result.model
  task.decisionId = result.decisionId
}

export function routeInput(task: NativeTask) {
  return {
    ...(task.decisionId !== undefined ? { decisionId: task.decisionId } : {}),
    prompt: task.prompt,
    ...(task.scope !== undefined ? { scope: task.scope } : {}),
    ...(task.acceptance !== undefined ? { acceptance: task.acceptance } : {}),
    parentRole: task.parentRole,
    ...(task.requiredRole !== undefined ? { requiredRole: task.requiredRole } : {}),
    rootSessionID: task.rootSessionID,
    parentSessionID: task.parentSessionID,
    kind: task.kind,
  }
}

export function assertCanCreate(parentRole: NativeTaskRole, kind: NativeTaskKind): void {
  if (kind === "consultation") {
    if (parentRole === "advisor") throw new Error("Advisor roles cannot consult other agents")
    return
  }
  if (!mayCreateTask(parentRole)) throw new Error(`${parentRole} roles cannot create child tasks`)
}

export function authorizeTask(task: NativeTask, callerSessionID: string, allowRoot = true): void {
  if (task.parentSessionID === callerSessionID || (allowRoot && task.rootSessionID === callerSessionID)) return
  throw new Error("Task access is limited to its parent session and root session")
}

export function hasCapacity(
  candidate: NativeTask,
  all: NativeTask[],
  maxConcurrent: number,
  providerLimits?: NativeTaskEngineOptions["providerConcurrency"],
  modelLimits?: NativeTaskEngineOptions["modelConcurrency"],
  defaultConcurrency = 5,
): boolean {
  const running = all.filter((task) => task.state === "running")
  if (running.length >= maxConcurrent) return false
  if (candidate.model === undefined) return true
  const candidateModel = candidate.model
  const modelKey = `${candidateModel.providerID}/${candidateModel.id}`
  const modelConfigured = configuredLimit(modelLimits, modelKey)
  const providerConfigured = configuredLimit(providerLimits, candidateModel.providerID)
  const providerLimit = resolveLimit(providerConfigured, Number.POSITIVE_INFINITY)
  const modelLimit = resolveLimit(modelConfigured, providerConfigured === undefined ? defaultConcurrency : providerLimit)
  const providerCount = running.filter((task) => task.model?.providerID === candidateModel.providerID).length
  const modelCount = running.filter((task) => task.model?.providerID === candidateModel.providerID && task.model.id === candidateModel.id).length
  return providerCount < providerLimit && modelCount < modelLimit
}

function configuredLimit(limits: NativeTaskEngineOptions["providerConcurrency"], key: string): number | undefined {
  return typeof limits === "number" ? limits : limits?.[key]
}

function resolveLimit(configured: number | undefined, fallback: number): number {
  const value = configured ?? fallback
  return value === 0 ? Number.POSITIVE_INFINITY : Math.max(1, value)
}

export function sameModel(left: NativeModelRef | undefined, right: NativeModelRef | undefined): boolean {
  return left !== undefined && right !== undefined && left.providerID === right.providerID && left.id === right.id
}
