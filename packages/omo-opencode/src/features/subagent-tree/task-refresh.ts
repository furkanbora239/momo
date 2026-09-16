import { clampFocus } from "../tui-card"
import type { FlatSubagentNode } from "./build-subagent-tree"

/**
 * Cheap change detector over the flattened subagent tree: any change to ids,
 * status, model, tools, preview, or tool-call count produces a different
 * signature.
 */
export function subagentSignature(lines: readonly FlatSubagentNode[]): string {
  return lines
    .map((line) =>
      [
        line.row.id,
        line.row.status,
        line.row.modelID ?? "",
        line.row.lastTool ?? "",
        line.row.activeTool ?? "",
        line.row.promptPreview ?? "",
        String(line.row.toolCalls ?? ""),
      ].join("|"),
    )
    .join(";")
}

/**
 * Index of the previously focused card in the new visible set; when the card
 * is gone the previous index is clamped into range.
 */
export function focusIndexPreservingId(
  cards: readonly { readonly id: string }[],
  previousId: string | undefined,
  previousIndex: number,
): number {
  if (previousId !== undefined) {
    const found = cards.findIndex((card) => card.id === previousId)
    if (found >= 0) return found
  }
  return clampFocus(previousIndex, cards.length)
}
