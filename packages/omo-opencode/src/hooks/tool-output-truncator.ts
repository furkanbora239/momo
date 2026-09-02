import type { PluginInput } from "@opencode-ai/plugin"
import type { ExperimentalConfig } from "../config/schema"
import { createDynamicTruncator } from "../shared/dynamic-truncator"

const DEFAULT_MAX_TOKENS = 50_000 // ~200k chars
const WEBFETCH_MAX_TOKENS = 10_000 // ~40k chars - web pages need aggressive truncation
const DEFAULT_MAX_OUTPUT_CHARS = 8_000 // ~2k tokens - hard cap from the cost-aware routing plan (Faz 4)

const TRUNCATABLE_TOOLS = [
  "grep",
  "Grep",
  "safe_grep",
  "glob",
  "Glob",
  "safe_glob",
  "lsp_diagnostics",
  "interactive_bash",
  "Interactive_bash",
  "skill_mcp",
  "webfetch",
  "WebFetch",
]

const TOOL_SPECIFIC_MAX_TOKENS: Record<string, number> = {
  webfetch: WEBFETCH_MAX_TOKENS,
  WebFetch: WEBFETCH_MAX_TOKENS,
}

interface ToolOutputTruncatorOptions {
  modelCacheState?: {
    anthropicContext1MEnabled: boolean
    modelContextLimitsCache?: Map<string, number>
  }
  experimental?: ExperimentalConfig
}

export function createToolOutputTruncatorHook(ctx: PluginInput, options?: ToolOutputTruncatorOptions) {
  const truncator = createDynamicTruncator(ctx, options?.modelCacheState)
  const truncateAll = options?.experimental?.truncate_all_tool_outputs ?? false
  const maxOutputChars = options?.experimental?.max_tool_output_chars ?? DEFAULT_MAX_OUTPUT_CHARS

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown }
  ) => {
    if (typeof output.output !== 'string') return

    if (truncateAll || TRUNCATABLE_TOOLS.includes(input.tool)) {
      try {
        const targetMaxTokens = TOOL_SPECIFIC_MAX_TOKENS[input.tool] ?? DEFAULT_MAX_TOKENS
        const { result, truncated } = await truncator.truncate(
          input.sessionID,
          output.output,
          { targetMaxTokens }
        )
        if (truncated) {
          output.output = result
        }
      } catch (error) {
        if (!(error instanceof Error)) {
          throw error
        }
      }
    }

    if (maxOutputChars > 0 && output.output.length > maxOutputChars) {
      output.output = `${output.output.slice(0, maxOutputChars)}\n[output truncated at ${maxOutputChars} characters by momo tool-output cap]`
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
  }
}
