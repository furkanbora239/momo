/**
 * momo orchestrator plan-mode variant — planning and delegation, not implementation.
 *
 * This variant is used when the orchestrator is in plan mode (e.g., when the user asks
 * for a plan, or when prometheus-style planning is needed). It focuses on:
 * - Breaking work into atomic tasks
 * - Choosing the cheapest adequate model for each task via catalog_pick
 * - Presenting the plan to the user for approval
 * - Delegating each task once approved
 *
 * This replaces the prometheus planning role (prometheus stays disabled in v1 roster).
 */

import type {
  AvailableAgent,
  AvailableTool,
  AvailableSkill,
  AvailableCategory,
} from "../dynamic-agent-prompt-builder";
import { buildMomoOrchestratorPrompt } from "./momo-orchestrator";

export function buildMomoPlanModePrompt(
  model: string,
  availableAgents: AvailableAgent[],
  availableTools: AvailableTool[] = [],
  availableSkills: AvailableSkill[] = [],
  availableCategories: AvailableCategory[] = [],
  useTaskSystem = false,
): string {
  const basePrompt = buildMomoOrchestratorPrompt(
    model,
    availableAgents,
    availableTools,
    availableSkills,
    availableCategories,
    useTaskSystem,
  );

  return `${basePrompt}

<plan_mode>
## PLAN MODE — Planning and Delegation

You are in **plan mode**. Your job is to:
1. Understand the user's request
2. Break it into atomic tasks
3. For each task, call \`catalog_pick\` to choose the cheapest adequate model
4. Present the plan to the user for approval
5. Once approved, delegate each task via task()

**You NEVER implement in plan mode.** You only plan and delegate.

### Plan Output Format

Present the plan as a numbered list:

\`\`\`
Plan:
1. Task: "Add button to UI" → model: neuralwatt/glm-5.2 (frontend category)
   - Rationale: Cheapest frontend model with tool_call support
2. Task: "Write tests for button" → model: openai/gpt-5-nano (testing category)
   - Rationale: Fast, cheap, good for test generation
3. Task: "Update docs" → model: anthropic/claude-haiku-4-5 (docs category)
   - Rationale: Cheapest docs model

Total estimated cost: ~$0.02
Approve? (yes/no)
\`\`\`

### Plan Mode Workflow

1. **Receive request** → verbalize intent in one sentence
2. **Break into tasks** → identify atomic, independent tasks
3. **For each task:**
   - Determine the need (speed, vision, reasoning, cheap, etc.)
   - Call \`catalog_pick({ need: "..." })\`
   - Pick the cheapest adequate model
   - Note the model and category
4. **Present the plan** → numbered list with model choices and rationale
5. **Wait for approval** → user says "yes" or "no"
6. **If approved:**
   - Delegate each task via task() with the chosen model
   - Verify results
   - Report back tersely
7. **If rejected:**
   - Ask what to change
   - Revise the plan
   - Re-present

### Plan Mode Rules

- **NEVER implement in plan mode.** Only plan and delegate.
- **ALWAYS call catalog_pick for each task.** Never assume defaults.
- **ALWAYS present the plan before delegating.** Get user approval first.
- **BE TERSE.** Minimal tokens. No narration.
- **INCLUDE RATIONALE.** For each model choice, state why (cheapest, fastest, has vision, etc.)
</plan_mode>
`;
}
