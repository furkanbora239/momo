import type { ToolDefinition } from "@opencode-ai/plugin"
import type { V2PluginContext } from "./types"
import { convertV1ToolDefinition } from "./tool-conversion"

export { convertV1ToolDefinition } from "./tool-conversion"

/**
 * Register every V1 tool in `tools` against the V2 tool domain. All tools are
 * added inside a single `transform` call (transforms are replayable, so the
 * callback stays synchronous and cheap — conversion is pure and precomputed per
 * tool before `editor.add`).
 */
export async function registerV2Tools(
  ctx: V2PluginContext,
  tools: Record<string, ToolDefinition> | undefined,
): Promise<void> {
  if (!tools) return
  const entries = Object.entries(tools)
  if (entries.length === 0) return
  await ctx.tool.transform((editor) => {
    for (const [name, def] of entries) {
      editor.add(convertV1ToolDefinition(name, def))
    }
  })
}
