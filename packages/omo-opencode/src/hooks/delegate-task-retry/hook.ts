

import type { PluginContext } from "../../plugin/types"
import { buildRetryGuidance } from "./guidance"
import { detectDelegateTaskError } from "./patterns"

export function createDelegateTaskRetryHook(_ctx: PluginContext) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: unknown }
    ) => {
      if (input.tool.toLowerCase() !== "task") return
      if (typeof output.output !== "string") return

      const errorInfo = detectDelegateTaskError(output.output)
      if (errorInfo) {
        const guidance = buildRetryGuidance(errorInfo)
        output.output += `\n${guidance}`
      }
    },
  }
}
