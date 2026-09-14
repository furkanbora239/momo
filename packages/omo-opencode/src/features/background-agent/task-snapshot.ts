import type { BackgroundTask, BackgroundTaskSnapshot } from "./types"

function resolvedModelID(task: BackgroundTask): string | null {
  if (!task.model) {
    return null
  }
  return `${task.model.providerID}/${task.model.modelID}`
}

function toSnapshot(task: BackgroundTask): BackgroundTaskSnapshot {
  const activeTool = task.progress?.activeTool
  const lastTool = activeTool ? `[Running: ${activeTool}]` : (task.progress?.lastTool ?? null)
  const startedAt = task.startedAt ?? task.queuedAt
  const modelID = resolvedModelID(task)
  return Object.freeze({
    title: task.description || `${task.agent} background task`,
    status: task.status,
    toolCalls: task.progress?.toolCalls ?? null,
    lastTool,
    agent: task.agent,
    ...(task.sessionId !== undefined ? { sessionId: task.sessionId } : {}),
    parentSessionId: task.parentSessionId,
    ...(modelID !== null ? { modelID } : {}),
    ...(activeTool !== undefined ? { activeTool } : {}),
    ...(startedAt !== undefined ? { startedAt: startedAt.getTime() } : {}),
  })
}

export function toBackgroundTaskSnapshots(tasks: Iterable<BackgroundTask>): BackgroundTaskSnapshot[] {
  return Array.from(tasks, toSnapshot)
}
