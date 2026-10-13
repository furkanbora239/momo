import type { NativeTask, NativeTaskState } from "../../native-task/types"

export type NativeTaskRow = {
  id: string
  role: string
  model: string
  state: NativeTaskState
  summary: string
  updatedAt: number
}
export type NativeTaskView = {
  status: "loading" | "ready" | "stale" | "unavailable"
  rows: readonly NativeTaskRow[]
}

const states: readonly NativeTaskState[] = ["awaiting_selection", "queued", "running", "waiting_question", "waiting_children", "succeeded", "failed", "cancelled", "interrupted"]

/** Reject malformed or cross-lineage responses before displaying task data. */
export function readNativeTaskRows(output: unknown, rootSessionID: string): NativeTaskRow[] {
  if (!output || typeof output !== "object" || !Array.isArray((output as { tasks?: unknown }).tasks)) {
    throw new Error("Invalid native task response")
  }
  const tasks = (output as { tasks: unknown[] }).tasks
  return tasks.map((value) => {
    if (!value || typeof value !== "object") throw new Error("Invalid native task")
    const task = value as Partial<NativeTask>
    if (task.rootSessionID !== rootSessionID || typeof task.id !== "string" || typeof task.prompt !== "string" || !states.includes(task.state as NativeTaskState)) {
      throw new Error("Invalid native task lineage or state")
    }
    if ((task.role !== undefined && typeof task.role !== "string") || (task.requiredRole !== undefined && typeof task.requiredRole !== "string")) throw new Error("Invalid native task role")
    const model = task.model
    if (model !== undefined && (typeof model.providerID !== "string" || typeof model.id !== "string")) throw new Error("Invalid native task model")
    return {
      id: task.id,
      updatedAt: typeof task.updatedAt === "number" ? task.updatedAt : 0,
      role: task.role ?? task.requiredRole ?? task.kind ?? "task",
      model: task.state === "awaiting_selection" || !model ? "unassigned" : `${model.providerID}/${model.id}`,
      state: task.state as NativeTaskState,
      summary: task.prompt.replace(/\s+/g, " ").trim().slice(0, 60),
    }
  }).sort((left, right) => {
    const finished = (state: NativeTaskState) => ["succeeded", "failed", "cancelled"].includes(state)
    return Number(finished(left.state)) - Number(finished(right.state)) || right.updatedAt - left.updatedAt
  })
}

export function nativeTaskViewText(view: NativeTaskView): string {
  const status = view.status === "ready" ? "" : ` (${view.status})`
  const rows = view.rows.map((row) => `${row.role} · ${row.state}\n${row.model}\n${row.summary}`)
  return `Subagent models${status}\n${rows.length ? rows.join("\n\n") : view.status === "ready" ? "No momo tasks in this session" : "Task status unavailable"}`
}
