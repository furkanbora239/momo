import type { AgentConfig } from "@opencode-ai/sdk"
import { loadPromptSync, executorPromptVariants } from "@oh-my-opencode/prompts-core"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { createAgentToolRestrictions } from "../../shared/permission-compat"

const MODE: AgentMode = "subagent"

export const EXECUTOR_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "CHEAP",
  promptAlias: "Executor",
  keyTrigger: "Orchestrator approves a plan and wants it executed via workers",
  triggers: [{ domain: "Execution", trigger: "Decompose plan, delegate to workers, collect results" }],
  useWhen: [
    "An approved plan needs decomposition into per-file/per-symbol tasks",
    "Multiple worker tasks need coordination and result aggregation",
  ],
  avoidWhen: [
    "Single trivial edit (delegate directly)",
    "Only planning is needed (use planner)",
  ],
}

function loadDefaultExecutorPrompt(): string {
  return loadPromptSync({
    source: executorPromptVariants.default,
    name: "executor",
    variant: "default",
  }).body
}

const EXECUTOR_SYSTEM_PROMPT = loadDefaultExecutorPrompt()

export function createExecutorAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions(
    ["write", "edit", "apply_patch", "call_omo_agent"],
    [],
  )

  return {
    description: "Manager-layer executor. Consumes an approved plan, delegates to task-category workers, collects results with diff + test evidence. Never edits directly. (Executor - momo)",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: EXECUTOR_SYSTEM_PROMPT,
  }
}
createExecutorAgent.mode = MODE
