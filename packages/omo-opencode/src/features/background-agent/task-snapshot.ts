import type { BackgroundTask, BackgroundTaskSnapshot } from "./types"

function toSnapshot(task: BackgroundTask): BackgroundTaskSnapshot {
  const activeTool = task.progress?.activeTool
  const lastTool = activeTool ? `[Running: ${activeTool}]` : (task.progress?.lastTool ?? null)
  return Object.freeze({
    title: task.description || `${task.agent} background task`,
    status: task.status,
    toolCalls: task.progress?.toolCalls ?? null,
    lastTool,
    agent: task.agent,
  })
}

export function toBackgroundTaskSnapshots(tasks: Iterable<BackgroundTask>): BackgroundTaskSnapshot[] {
  return Array.from(tasks, toSnapshot)
}
