import type { BackgroundTaskSnapshot } from "../background-agent/types"
import type { TrackedTask } from "../task-toast-manager/types"
import type { CollectSubagentRowsInput, SubagentRow } from "./types"

function rowFromSnapshot(task: BackgroundTaskSnapshot): SubagentRow {
  return {
    id: task.sessionId ?? `bg:${task.agent}:${task.title}`,
    parentId: task.parentSessionId ?? null,
    agent: task.agent,
    modelID: task.modelID ?? null,
    taskLabel: task.title,
    promptPreview: task.promptPreview ?? null,
    status: task.status,
    startedAt: task.startedAt ?? null,
    toolCalls: task.toolCalls,
    lastTool: task.lastTool,
    activeTool: task.activeTool ?? null,
  }
}

function rowFromTrackedTask(task: TrackedTask): SubagentRow {
  return {
    id: task.sessionID ?? `task:${task.id}`,
    parentId: null,
    agent: task.agent,
    modelID: task.modelInfo?.model ?? null,
    taskLabel: task.description,
    promptPreview: null,
    status: task.status,
    startedAt: task.startedAt.getTime(),
    toolCalls: task.toolCalls ?? null,
    lastTool: task.lastTool ?? null,
    activeTool: task.activeTool ?? null,
  }
}

function mergeRows(background: readonly SubagentRow[], toast: readonly SubagentRow[]): SubagentRow[] {
  const merged = new Map<string, SubagentRow>()
  for (const row of background) {
    merged.set(row.id, row)
  }
  for (const row of toast) {
    const existing = merged.get(row.id)
    if (existing === undefined) {
      merged.set(row.id, row)
      continue
    }
    merged.set(row.id, {
      ...existing,
      status: row.status,
      modelID: row.modelID ?? existing.modelID,
      toolCalls: row.toolCalls ?? existing.toolCalls,
      lastTool: row.lastTool ?? existing.lastTool,
      activeTool: row.activeTool ?? existing.activeTool,
      startedAt: row.startedAt ?? existing.startedAt,
    })
  }
  return [...merged.values()]
}

export function collectSubagentRows(input: CollectSubagentRowsInput): SubagentRow[] {
  const backgroundRows = (input.backgroundManager?.getTasksSnapshot() ?? []).map(rowFromSnapshot)
  const runningTasks = input.toastManager?.getRunningTasks() ?? []
  const queuedTasks = input.toastManager?.getQueuedTasks?.() ?? []
  const toastRows = [...runningTasks, ...queuedTasks].map(rowFromTrackedTask)
  return mergeRows(backgroundRows, toastRows)
}
