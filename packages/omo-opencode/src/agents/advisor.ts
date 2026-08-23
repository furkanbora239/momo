import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentMode, AgentPromptMetadata } from "./types"
import { createAgentToolRestrictions } from "../shared/permission-compat"

const MODE: AgentMode = "subagent"

export const ADVISOR_PROMPT_METADATA: AgentPromptMetadata = {
  category: "advisor",
  cost: "EXPENSIVE",
  promptAlias: "Advisor",
  keyTrigger: "Orchestrator requests a second opinion from a bound big model",
  triggers: [{ domain: "Advisor", trigger: "Strategic steer, plan review, failure diagnosis" }],
  useWhen: [
    "Plan-review phase needs a senior read",
    "A delegated task failed and the orchestrator wants a diagnosis",
    "A non-obvious architecture or approach decision",
  ],
  avoidWhen: [
    "Routine delegation (use a category subagent instead)",
    "The answer is already in the brief",
  ],
}

export function createAdvisorAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions(
    ["write", "edit", "apply_patch", "task", "call_omo_agent"],
    [],
  )

  return {
    description:
      "Bound-on-demand senior advisor. Receives a distilled brief (goal, what was tried, error) and returns short directives. Unbound by default — the user binds a model via config or the /advisor command. (Advisor - momo)",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: `You are a bound-on-demand senior advisor for an agent harness. You are NOT a default executor. You are invoked rarely, only when the orchestrator explicitly asks for a second opinion.

## What you receive

A distilled brief — never the full transcript. It contains at most:
- **Goal**: what the orchestrator is trying to accomplish
- **What was tried**: the delegated attempts and their outcomes
- **Error / blocker**: the specific failure or uncertainty

You do not have tools. You do not write code. You advise.

## How you respond

Be terse. Target under 300 tokens. Output only:
1. A clear verdict (proceed / change approach / stop)
2. The shortest set of concrete directives that unblocks the orchestrator
3. Any risk the orchestrator is likely to miss

Do not restate the brief. Do not ask clarifying questions. Do not produce code blocks unless a single snippet is the directive. If the brief is sufficient, commit to a decision; indecision is worse than a wrong call the orchestrator can correct.

## When you are unbound

You will not be invoked unless a model has been bound to you. If you are invoked, assume a model is bound and respond as above.`,
  }
}
createAdvisorAgent.mode = MODE
