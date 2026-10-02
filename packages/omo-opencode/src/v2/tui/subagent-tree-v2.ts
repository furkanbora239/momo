import { log } from "../../shared/logger"
import type { BackgroundTaskSnapshot } from "../../features/background-agent/types"
import type { SolidRuntime } from "../../features/tui-card"
import { POLL_INTERVAL_MS } from "../../features/tui-sidebar/constants"
import {
  buildSubagentTree,
  collectSubagentRows,
  flattenSubagentTree,
  subagentSignature,
  type SubagentRow,
} from "../../features/subagent-tree"
import { buildTaskCards, taskFilterTexts, type TaskCard } from "../../features/subagent-tree/task-cards"
import { readMirror } from "../../features/tui-sidebar/mirror-io"
import type { JobRow } from "../../features/tui-sidebar/state-types"
import { createCardDialogV2 } from "./card-dialog-v2"
import { showPromptDetailV2 } from "./prompt-detail-v2"
import type { SolidNode } from "./solid-loader"
import type { V2TuiContext } from "./types"
import type { V2TuiFacade } from "./tui-facade"

const CARD_MODE = "omo.tui-card.tasks"
const EMPTY_GHOST = "no subagents yet - updates live"
const FILTER_GHOST = "no cards match the filter"

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

function tasksHint(): string {
  return "up/down or j/k move - Enter opens prompt detail - Esc clears filter then closes"
}

type SubagentTreeState = {
  refreshTimer: ReturnType<typeof setTimeout> | null
  signature: string
  cards: readonly TaskCard[]
}

/**
 * V2 port of the /tasks subagent tree: the V1 dialog stack, mode push, card
 * keymap, and slash command map onto ui.dialog.show/set/clear,
 * keymap.mode.push, a mode-scoped keymap layer, and a palette + slash keymap
 * command. The mirror polling loop is unchanged.
 */
export function registerSubagentTreeV2(
  ctx: V2TuiContext,
  facade: V2TuiFacade,
  solid: SolidRuntime<SolidNode>,
): void {
  log("[subagent-tree] V2 TUI registration started")

  const state: SubagentTreeState = {
    refreshTimer: null,
    signature: "",
    cards: [],
  }

  const directory = (): string | undefined => facade.directory()

  const controller = createCardDialogV2<SolidNode, TaskCard>({
    solid,
    facade,
    mode: CARD_MODE,
    title: "Subagents",
    hint: tasksHint,
    footerHint: () => undefined,
    ghostLine: () => (state.cards.length === 0 ? EMPTY_GHOST : FILTER_GHOST),
    filterTexts: taskFilterTexts,
    onActivate: (card) => {
      if (card.row.sessionId === null) return
      void showPromptDetailV2(ctx, facade, card.row, openTasksDialog)
    },
  })

  const stopPolling = (): void => {
    if (state.refreshTimer !== null) {
      clearTimeout(state.refreshTimer)
      state.refreshTimer = null
    }
  }

  const scheduleRefresh = (): void => {
    if (state.refreshTimer !== null) return
    state.refreshTimer = setTimeout(refreshTick, POLL_INTERVAL_MS)
  }

  const rowsFromMirror = (): readonly SubagentRow[] | null => {
    const dir = directory()
    if (dir === undefined) return null
    const mirror = readMirror(dir)
    if (mirror === null) return null
    return collectSubagentRows({
      backgroundManager: {
        getTasksSnapshot: () => mirror.jobBoard.map(jobRowToSnapshot),
      },
    })
  }

  const cardsFromRows = (rows: readonly SubagentRow[]): TaskCard[] =>
    buildTaskCards(flattenSubagentTree(buildSubagentTree(rows)))

  const refreshTick = (): void => {
    state.refreshTimer = null
    if (!controller.isOpen()) return
    const rows = rowsFromMirror()
    if (rows === null) {
      scheduleRefresh()
      return
    }
    const cards = cardsFromRows(rows)
    const nextSignature = subagentSignature(
      flattenSubagentTree(buildSubagentTree(rows)),
    )
    if (nextSignature !== state.signature) {
      state.cards = cards
      state.signature = nextSignature
      controller.refresh(cards)
    }
    scheduleRefresh()
  }

  function openTasksDialog(): void {
    if (controller.isOpen()) {
      controller.close()
    }
    const rows = rowsFromMirror()
    if (rows === null) {
      facade.toast({
        variant: "warning",
        message: "No fresh subagent data is available yet.",
      })
      return
    }
    state.cards = cardsFromRows(rows)
    state.signature = subagentSignature(flattenSubagentTree(buildSubagentTree(rows)))
    controller.open(state.cards)
    scheduleRefresh()
  }

  facade.addKeymapLayer(() => ({
    commands: [
      {
        id: "omo.subagent-tree.tasks",
        title: "Subagent tasks",
        description:
          "Show running and queued subagents with model, task, and parent tree",
        group: "Session",
        palette: true,
        slash: { name: "tasks", aliases: ["agents", "subagents"] },
        run: () => openTasksDialog(),
      },
    ],
  }))

  facade.onCleanup(() => {
    stopPolling()
    if (controller.isOpen()) {
      controller.suspend()
    }
  })

  log("[subagent-tree] V2 TUI controls registered")
}
