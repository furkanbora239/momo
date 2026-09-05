import type { AgentConfig } from "@opencode-ai/sdk"
import { loadPromptSync, plannerPromptVariants } from "@oh-my-opencode/prompts-core"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { createAgentToolRestrictions } from "../../shared/permission-compat"

const MODE: AgentMode = "all"

export const PLANNER_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "CHEAP",
  promptAlias: "Planner",
  keyTrigger: "Orchestrator requests a structured plan before execution",
  triggers: [{ domain: "Planning", trigger: "Gather context, produce work plan" }],
  useWhen: [
    "Orchestrator wants a plan before committing to execution",
    "Multi-step work needs decomposition + dependency analysis",
  ],
  avoidWhen: [
    "Single trivial edit (delegate directly)",
    "Only exploration is needed (use explore)",
  ],
}

function loadDefaultPlannerPrompt(): string {
  return loadPromptSync({
    source: plannerPromptVariants.default,
    name: "planner",
    variant: "default",
  }).body
}

const PLANNER_SYSTEM_PROMPT = loadDefaultPlannerPrompt()

export function createPlannerAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions(
    ["write", "edit", "apply_patch"],
    [],
  )

  return {
    description: "Manager-layer planner. Gathers context via explore/librarian, produces a structured work plan. Never edits. Can spawn sync worker tasks. (Planner - momo)",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: PLANNER_SYSTEM_PROMPT,
  }
}
createPlannerAgent.mode = MODE
