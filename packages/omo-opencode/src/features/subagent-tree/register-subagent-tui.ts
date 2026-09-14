import type {
  TuiDialogSelectOption,
  TuiDialogStack,
  TuiPluginApi,
} from "@opencode-ai/plugin/tui"

import { log } from "../../shared/logger"
import type { BackgroundTaskSnapshot } from "../background-agent/types"
import { readMirror } from "../tui-sidebar/mirror-io"
import type { JobRow } from "../tui-sidebar/state-types"
import { buildSubagentTree, flattenSubagentTree, type FlatSubagentNode } from "./build-subagent-tree"
import { collectSubagentRows } from "./collect-subagent-rows"
import { formatSubagentLine } from "./format-subagent-line"

type SolidRuntime<Node> = {
  readonly createElement: (tag: string) => Node
  readonly insert: (
    parent: Node,
    child: unknown,
    marker?: unknown,
    initial?: unknown,
  ) => unknown
  readonly setProp: (
    node: Node,
    name: string,
    value: unknown,
    previous?: unknown,
  ) => unknown
}

type TaskOptionValue = { readonly kind: "close" }

function jobRowToSnapshot(job: JobRow): BackgroundTaskSnapshot {
  return {
    title: job.title,
    status: job.status,
    toolCalls: job.toolCalls,
    lastTool: job.lastTool,
    agent: job.agent ?? "subagent",
    sessionId: job.sessionId,
    parentSessionId: job.parentSessionId,
    modelID: job.model ?? null,
    promptPreview: job.promptPreview ?? null,
    startedAt: job.startedAt,
  }
}

function buildOptions(lines: readonly FlatSubagentNode[]): TuiDialogSelectOption<TaskOptionValue>[] {
  const closeOption: TuiDialogSelectOption<TaskOptionValue> = {
    title: "Close subagent view",
    value: { kind: "close" },
    description: "Read-only view; selecting any row also closes it",
  }
  const rowOptions: TuiDialogSelectOption<TaskOptionValue>[] = lines.map((line) => ({
    title: formatSubagentLine(line.row, line.depth),
    value: { kind: "close" },
  }))
  return [closeOption, ...rowOptions]
}

function renderTasksDialog(
  api: TuiPluginApi,
  dialogStack: TuiDialogStack,
  lines: readonly FlatSubagentNode[],
) {
  return () =>
    api.ui.DialogSelect<TaskOptionValue>({
      title: "Subagents",
      placeholder: "Filter subagents",
      options: buildOptions(lines),
      onSelect: () => {
        dialogStack.clear()
        api.renderer.requestRender()
      },
    })
}

function openTasksDialog(api: TuiPluginApi, dialogStack: TuiDialogStack): void {
  const mirror = readMirror(api.state.path.directory)
  if (mirror === null) {
    api.ui.toast({
      variant: "warning",
      message: "No fresh subagent data is available yet.",
    })
    return
  }
  const rows = collectSubagentRows({
    backgroundManager: {
      getTasksSnapshot: () => mirror.jobBoard.map(jobRowToSnapshot),
    },
  })
  if (rows.length === 0) {
    api.ui.toast({
      variant: "info",
      message: "No running or queued subagents.",
    })
    return
  }
  const lines = flattenSubagentTree(buildSubagentTree(rows))
  dialogStack.replace(renderTasksDialog(api, dialogStack, lines))
}

/**
 * The `solid` runtime is kept for signature parity with the btw-side and
 * model-pool TUI wiring; this feature renders exclusively through api.ui
 * dialog components.
 */
export async function registerSubagentTreeTui<Node>(
  api: TuiPluginApi,
  _solid: SolidRuntime<Node>,
): Promise<void> {
  log("[subagent-tree] TUI registration started")

  const unregisterSlashCommand =
    api.command?.register(() => [
      {
        title: "Subagent tasks",
        value: "omo.subagent-tree.slash",
        description: "Show running and queued subagents with model, task, and parent tree",
        category: "Session",
        enabled: true,
        slash: {
          name: "tasks",
          aliases: ["agents", "subagents"],
        },
        onSelect: (dialog) => openTasksDialog(api, dialog ?? api.ui.dialog),
      },
    ]) ?? (() => undefined)

  api.lifecycle.onDispose(() => {
    unregisterSlashCommand()
  })

  log("[subagent-tree] TUI controls registered")
}
