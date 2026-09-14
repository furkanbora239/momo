import type { SubagentRow } from "./types"

const INDENT = "  "

export function formatSubagentLine(row: SubagentRow, depth: number): string {
  const indent = INDENT.repeat(Math.max(0, depth))
  const model = row.modelID ?? "model unknown"
  const task = row.promptPreview ?? row.taskLabel
  const runningSuffix = row.activeTool ? ` [Running: ${row.activeTool}]` : ""
  return `${indent}${row.agent} · ${model} · ${task} · ${row.status}${runningSuffix}`
}
