import type { CardDescriptor, CardTone } from "../tui-card"
import type { FlatSubagentNode } from "./build-subagent-tree"
import type { SubagentRow } from "./types"

export const TASK_PREVIEW_MAX_COLS = 60

export type TaskCard = CardDescriptor & {
  readonly row: SubagentRow
  readonly depth: number
}

export function truncateTaskPreview(value: string, maxCols: number): string {
  if (value.length <= maxCols) return value
  return `${value.slice(0, Math.max(0, maxCols - 3))}...`
}

export function taskStatusTone(status: string): CardTone {
  switch (status) {
    case "running":
      return "positive"
    case "pending":
    case "queued":
    case "interrupt":
      return "warning"
    case "error":
    case "cancelled":
      return "negative"
    case "completed":
      return "muted"
    default:
      return "neutral"
  }
}

export function taskBodyLines(row: SubagentRow): string[] {
  const model = row.modelID ?? "model unknown"
  const task = row.promptPreview ?? row.taskLabel
  const lines = [model, truncateTaskPreview(task, TASK_PREVIEW_MAX_COLS)]
  if (row.activeTool !== null) {
    lines.push(`[Running: ${row.activeTool}]`)
  }
  return lines
}

export function taskFilterTexts(card: TaskCard): readonly string[] {
  const row = card.row
  return [
    row.agent,
    row.modelID ?? "",
    row.taskLabel,
    row.promptPreview ?? "",
    row.status,
  ]
}

export function buildTaskCards(lines: readonly FlatSubagentNode[]): TaskCard[] {
  return lines.map((line, index) => ({
    id: `task-${index}`,
    row: line.row,
    depth: line.depth,
    title: line.row.agent,
    badge: { text: line.row.status, tone: taskStatusTone(line.row.status) },
    bodyLines: taskBodyLines(line.row),
    indent: line.depth,
  }))
}
