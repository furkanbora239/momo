import type {
  TuiDialogSelectOption,
  TuiDialogStack,
  TuiPluginApi,
} from "@opencode-ai/plugin/tui"

import type { SubagentRow } from "./types"
import { promptDetailLines } from "./prompt-reader"

type DetailOptionValue = { readonly kind: "back" }

function metadataLine(row: SubagentRow): string {
  const model = row.modelID ?? "model unknown"
  return `${row.agent} · ${model} · ${row.status}`
}

function buildDetailOptions(
  row: SubagentRow,
  prompt: string | null,
): TuiDialogSelectOption<DetailOptionValue>[] {
  const backOption: TuiDialogSelectOption<DetailOptionValue> = {
    title: "Back to subagent tasks",
    value: { kind: "back" },
    description: "Return to the task list",
  }
  const lines = [metadataLine(row), "", ...promptDetailLines(prompt)]
  const lineOptions: TuiDialogSelectOption<DetailOptionValue>[] = lines.map((line) => ({
    title: line.length > 0 ? line : " ",
    value: { kind: "back" },
  }))
  return [backOption, ...lineOptions]
}

/**
 * Read-only detail view for one subagent row: model, agent, status, and the
 * prompt the orchestrator gave it (read live from the subagent's session
 * store; never persisted in the momo mirror).
 */
export function renderPromptDetailDialog(
  api: TuiPluginApi,
  dialogStack: TuiDialogStack,
  row: SubagentRow,
  prompt: string | null,
  reopenTasks: () => void,
): void {
  dialogStack.replace(() =>
    api.ui.DialogSelect<DetailOptionValue>({
      title: "Prompt detail",
      placeholder: "Filter prompt lines",
      options: buildDetailOptions(row, prompt),
      onSelect: () => {
        reopenTasks()
        api.renderer.requestRender()
      },
    }),
  )
}
