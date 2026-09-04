import type { AgentConfig } from "@opencode-ai/sdk"
import { loadPromptSync, researchPromptVariants } from "@oh-my-opencode/prompts-core"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { createAgentToolRestrictions } from "../../shared/permission-compat"

const MODE: AgentMode = "subagent"

export const RESEARCH_PROMPT_METADATA: AgentPromptMetadata = {
  category: "exploration",
  cost: "CHEAP",
  promptAlias: "Research",
  keyTrigger: "Deep multi-file codebase investigation or technical documentation research",
  triggers: [{ domain: "Research", trigger: "Trace architecture, analyze dependencies, investigate external APIs" }],
  useWhen: [
    "Complex questions requiring deep multi-file or cross-module tracing",
    "Analyzing architecture, APIs, or performance bottlenecks",
  ],
  avoidWhen: [
    "Simple grep or file lookup (use explore)",
    "Code changes required (use quick or executor)",
  ],
}

function loadDefaultResearchPrompt(): string {
  return loadPromptSync({
    source: researchPromptVariants.default,
    name: "research",
    variant: "default",
  }).body
}

const RESEARCH_SYSTEM_PROMPT = loadDefaultResearchPrompt()

export function createResearchAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions(
    ["write", "edit", "apply_patch", "task", "call_omo_agent"],
    ["lsp_symbols", "lsp_goto_definition", "lsp_find_references", "lsp_diagnostics"],
  )

  return {
    description: "Deep research worker. Performs multi-module codebase investigation, call hierarchy analysis, and documentation research. Read-only. (Research - momo)",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: RESEARCH_SYSTEM_PROMPT,
  }
}
createResearchAgent.mode = MODE
