// MODIFIED: optional low-context monitoring while retaining full inspection.
import type { NativeTask } from "../native-task"
import { compactTask } from "./task-tool-output"

export function nextTaskActions(task: Pick<NativeTask, "state" | "kind" | "parentSessionID" | "rootSessionID" | "questionEscalated">, callerSessionID?: string): readonly string[] {
  switch (task.state) {
    case "awaiting_selection": return callerSessionID === task.parentSessionID ? ["candidates", "select"] : ["candidates"]
    case "waiting_question": return task.kind === "task" && (callerSessionID === task.parentSessionID || task.questionEscalated && callerSessionID === task.rootSessionID) ? ["detail", "answer"] : ["detail"]
    case "interrupted": return task.kind === "task" ? ["detail", "resume", "cancel"] : ["detail"]
    case "succeeded": return ["result"]
    case "failed": case "cancelled": return ["detail", "result"]
    default: return task.kind === "task" ? ["wait", "cancel"] : ["wait"]
  }
}

export function taskToolView(task: NativeTask, view?: "brief" | "full", callerSessionID?: string) {
  const full = compactTask(task)
  if (view !== "brief") return full
  return {
    id: full.id, state: full.state, decisionId: full.selection.required ? full.decisionId : undefined,
    role: full.role, model: full.model, error: full.error, question: full.question,
    resultInfo: full.resultInfo ? { available: true, length: full.resultInfo.length, previewOmitted: true } : undefined, verification: full.execution.verification,
    nextActions: nextTaskActions(task, callerSessionID),
  }
}
