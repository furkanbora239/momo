import type { AgentConfig } from "@opencode-ai/sdk"
import { loadPromptSync, reviewerPromptVariants } from "@oh-my-opencode/prompts-core"
import type { AgentMode, AgentPromptMetadata } from "../types"
import { createAgentToolRestrictions } from "../../shared/permission-compat"

const MODE: AgentMode = "subagent"

export const REVIEWER_PROMPT_METADATA: AgentPromptMetadata = {
  category: "specialist",
  cost: "CHEAP",
  promptAlias: "Reviewer",
  keyTrigger: "Audit code diffs, verify correctness, and check for regressions or security issues",
  triggers: [{ domain: "Review", trigger: "Audit diffs, run verification tests, inspect code quality" }],
  useWhen: [
    "Manager or Orchestrator wants an adversarial or structured review of code changes",
    "Changes need regression checks, security audits, or test verification",
  ],
  avoidWhen: [
    "Single trivial edit (fix directly)",
    "Only planning or writing code is needed",
  ],
}

function loadDefaultReviewerPrompt(): string {
  return loadPromptSync({
    source: reviewerPromptVariants.default,
    name: "reviewer",
    variant: "default",
  }).body
}

const REVIEWER_SYSTEM_PROMPT = loadDefaultReviewerPrompt()

export function createReviewerAgent(model: string): AgentConfig {
  const restrictions = createAgentToolRestrictions(
    ["write", "edit", "apply_patch"],
    [],
  )

  return {
    description: "Manager-layer reviewer. Audits code changes, runs test verification, checks edge cases and security. Never edits directly. Can spawn sync worker tasks. (Reviewer - momo)",
    mode: MODE,
    model,
    temperature: 0.1,
    ...restrictions,
    prompt: REVIEWER_SYSTEM_PROMPT,
  }
}
createReviewerAgent.mode = MODE
