import type { BackgroundTaskSnapshot } from "../background-agent/types"
import type { TrackedTask } from "../task-toast-manager/types"

export type SubagentRow = {
  readonly id: string
  /** Session id of the subagent's own session, when one exists; null otherwise. */
  readonly sessionId: string | null
  readonly parentId: string | null
  readonly agent: string
  readonly modelID: string | null
  readonly taskLabel: string
  readonly promptPreview: string | null
  readonly status: string
  readonly startedAt: number | null
  readonly toolCalls: number | null
  readonly lastTool: string | null
  readonly activeTool: string | null
}

export type SubagentToastProvider = {
  readonly getRunningTasks: () => readonly TrackedTask[]
  readonly getQueuedTasks?: () => readonly TrackedTask[]
}

export type SubagentBackgroundProvider = {
  readonly getTasksSnapshot: () => readonly BackgroundTaskSnapshot[]
}

export type CollectSubagentRowsInput = {
  readonly toastManager?: SubagentToastProvider
  readonly backgroundManager?: SubagentBackgroundProvider
}
