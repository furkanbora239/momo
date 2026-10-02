import type { DialogSelectOption } from "@opencode/plugin/tui/context"

import { log } from "../../shared/logger"
import { promptDetailLines } from "../../features/subagent-tree/prompt-reader"
import type { SubagentRow } from "../../features/subagent-tree/types"
import type { V2TuiContext } from "./types"
import type { V2TuiFacade } from "./tui-facade"

type DetailOptionValue = { readonly kind: "back" }

type UserMessageLike = {
  readonly type: string
  readonly text?: string
}

function firstUserText(messages: readonly UserMessageLike[]): string | null {
  const firstUser = messages.find((message) => message.type === "user")
  if (firstUser === undefined || firstUser.text === undefined) {
    return null
  }
  const text = firstUser.text.trim()
  return text.length > 0 ? text : null
}

/**
 * Reads the prompt the orchestrator gave a subagent from the V2 data model.
 * The V1 reader preferred the delegate-task `subtask` part prompt; the V2
 * session message model carries only the user message text, so this degrades
 * to text-only extraction. Freshness ladder: cached list, then sync + list,
 * then an on-demand server fetch.
 */
export async function readSubagentPromptV2(
  ctx: V2TuiContext,
  sessionId: string,
): Promise<string | null> {
  const cached = firstUserText(ctx.data.session.message.list(sessionId))
  if (cached !== null) return cached
  await ctx.data.session.message.sync(sessionId).catch((error: unknown) => {
    log("[subagent-tree] V2 message sync failed", { sessionId, error: String(error) })
  })
  const synced = firstUserText(ctx.data.session.message.list(sessionId))
  if (synced !== null) return synced
  try {
    const response = await ctx.client.message.list({
      sessionID: sessionId,
      type: "user",
      order: "asc",
      limit: 1,
    })
    return firstUserText(response.data)
  } catch (error) {
    log("[subagent-tree] V2 on-demand prompt fetch failed", {
      sessionId,
      error: String(error),
    })
    return null
  }
}

function metadataLine(row: SubagentRow): string {
  const model = row.modelID ?? "model unknown"
  return `${row.agent} · ${model} · ${row.status}`
}

function buildDetailOptions(
  row: SubagentRow,
  prompt: string | null,
): DialogSelectOption<DetailOptionValue>[] {
  const backOption: DialogSelectOption<DetailOptionValue> = {
    title: "Back to subagent tasks",
    value: { kind: "back" },
    description: "Return to the task list",
  }
  const lines = [metadataLine(row), "", ...promptDetailLines(prompt)]
  const lineOptions: DialogSelectOption<DetailOptionValue>[] = lines.map((line) => ({
    title: line.length > 0 ? line : " ",
    value: { kind: "back" },
  }))
  return [backOption, ...lineOptions]
}

/**
 * Read-only prompt detail for one subagent row, ported from the V1
 * DialogSelect-based detail dialog to the V2 promise-based
 * ui.dialog.select; resolving the select (pick or cancel) reopens the
 * task list.
 */
export async function showPromptDetailV2(
  ctx: V2TuiContext,
  facade: V2TuiFacade,
  row: SubagentRow,
  reopenTasks: () => void,
): Promise<void> {
  const sessionId = row.sessionId
  const prompt = sessionId === null ? null : await readSubagentPromptV2(ctx, sessionId)
  await ctx.ui.dialog.select({
    title: "Prompt detail",
    placeholder: "Filter prompt lines",
    options: buildDetailOptions(row, prompt),
  })
  reopenTasks()
  facade.requestRender()
}
