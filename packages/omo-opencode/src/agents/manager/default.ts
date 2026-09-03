import type { AgentConfig } from "@opencode-ai/sdk"
import { loadPromptSync, managerPromptVariants } from "@oh-my-opencode/prompts-core"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { createAgentToolRestrictions } from "../../shared/permission-compat"

const MODE: AgentMode = "subagent"

export const MANAGER_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "CHEAP",
  promptAlias: "Manager",
  keyTrigger: "Orchestrator delegates a substantive task for triage, planning, or execution",
  triggers: [{ domain: "Dispatch", trigger: "Evaluate task, select Planner or Executor, pick lead model" }],
  useWhen: [
    "Orchestrator wants to delegate a multi-step task or implementation",
    "Task needs routing to Planner or Executor with a cost-optimal lead model",
  ],
  avoidWhen: [
    "Single trivial edit (fix typos directly in orchestrator)",
  ],
}

function loadDefaultManagerPrompt(): string {
  return loadPromptSync({
    source: managerPromptVariants.default,
    name: "manager",
    variant: "default",
  }).body
}

const MANAGER_SYSTEM_PROMPT = loadDefaultManagerPrompt()

export function createManagerAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions(
    ["write", "edit", "apply_patch", "call_omo_agent"],
    [],
  )

  return {
    description: "Tier-2 manager/dispatcher. Evaluates task, selects Planner or Executor, picks lead model via catalog_pick. Never edits directly. (Manager - momo)",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: MANAGER_SYSTEM_PROMPT,
  }
}
createManagerAgent.mode = MODE
