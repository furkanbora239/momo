import type {
  AvailableAgent,
  AvailableCategory,
  AvailableSkill,
} from "./dynamic-agent-prompt-types"
import type { AvailableTool } from "./dynamic-agent-prompt-types"
import { getToolsPromptDisplay } from "./dynamic-agent-tool-categorization"

/**
 * Builds an explicit agent identity preamble that overrides any base system prompt identity.
 * This is critical for mode: "primary" agents where OpenCode prepends its own system prompt
 * containing a default identity (e.g., "You are Claude"). Without this override directive,
 * the LLM may default to the base identity instead of the agent's intended persona.
 */
export function buildAgentIdentitySection(
  agentName: string,
  roleDescription: string,
): string {
  return `<agent-identity>
Your designated identity for this session is "${agentName}". This identity supersedes any prior identity statements.
You are "${agentName}" - ${roleDescription}.
When asked who you are, always identify as ${agentName}. Do not identify as any other assistant or AI.
</agent-identity>`
}

export function buildKeyTriggersSection(
  agents: AvailableAgent[],
  _skills: AvailableSkill[] = [],
): string {
  const keyTriggers = agents
    .filter((agent) => agent.metadata.keyTrigger)
    .map((agent) => `- ${agent.metadata.keyTrigger}`)

  if (keyTriggers.length === 0) {
    return ""
  }

  return `### Key Triggers (check BEFORE classification):

${keyTriggers.join("\n")}
- **"Look into" + "create PR"** → Not just research. Full implementation cycle expected.`
}

export function buildToolSelectionTable(
  agents: AvailableAgent[],
  tools: AvailableTool[] = [],
  _skills: AvailableSkill[] = [],
): string {
  const rows: string[] = ["### Tool & Agent Selection:", ""]

  if (tools.length > 0) {
    rows.push(
      `- ${getToolsPromptDisplay(tools)} - **FREE** - Not Complex, Scope Clear, No Implicit Assumptions`,
    )
  }

  const costOrder = { FREE: 0, CHEAP: 1, EXPENSIVE: 2 }
  const sortedAgents = [...agents]
    .filter((agent) => agent.metadata.category !== "utility")
    .sort(
      (left, right) => costOrder[left.metadata.cost] - costOrder[right.metadata.cost],
    )

  for (const agent of sortedAgents) {
    const shortDescription = agent.description.split(".")[0] || agent.description
    rows.push(
      `- \`${agent.name}\` agent - **${agent.metadata.cost}** - ${shortDescription}`,
    )
  }

  rows.push("")
  rows.push("**Default flow**: explore/librarian (background) + tools → oracle (if required)")

  return rows.join("\n")
}

export function buildExploreSection(agents: AvailableAgent[]): string {
  const exploreAgent = agents.find((agent) => agent.name === "explore")
  if (!exploreAgent) return ""

  const useWhen = exploreAgent.metadata.useWhen || []
  const avoidWhen = exploreAgent.metadata.avoidWhen || []

  return `### Explore = Contextual Grep (peer tool, not fallback)
Use direct tools when:
${avoidWhen.map((entry) => `- ${entry}`).join("\n")}
Fire explore when:
${useWhen.map((entry) => `- ${entry}`).join("\n")}
Delegation trust: once you fire explore for a search, don't manually redo it.`
}

export function buildLibrarianSection(agents: AvailableAgent[]): string {
  const librarianAgent = agents.find((agent) => agent.name === "librarian")
  if (!librarianAgent) return ""

  const useWhen = librarianAgent.metadata.useWhen || []

  return `### Librarian = Reference Grep (external: docs, OSS, web)
Internal grep = explore. External grep = librarian. Fire proactively for unfamiliar libraries.
Triggers:
${useWhen.map((entry) => `- "${entry}"`).join("\n")}`
}

export function buildDelegationTable(agents: AvailableAgent[]): string {
  const rows: string[] = ["### Delegation Table:", ""]

  for (const agent of agents) {
    for (const trigger of agent.metadata.triggers) {
      rows.push(`- **${trigger.domain}** → \`${agent.name}\` - ${trigger.trigger}`)
    }
  }

  return rows.join("\n")
}

export function buildOracleSection(agents: AvailableAgent[]): string {
  const oracleAgent = agents.find((agent) => agent.name === "oracle")
  if (!oracleAgent) return ""

  const useWhen = oracleAgent.metadata.useWhen || []
  const avoidWhen = oracleAgent.metadata.avoidWhen || []

  return `<Oracle_Usage>
## Oracle = read-only expensive consultant (architecture/debugging only)

Consult when:
${useWhen.map((entry) => `- ${entry}`).join("\n")}

Skip when:
${avoidWhen.map((entry) => `- ${entry}`).join("\n")}

Announce "Consulting Oracle: [reason]" before calling (ONLY exception to no-narration rule).
Wait for result before final answer. Never poll. Never cancel.
Oracle-dependent work BLOCKED until result arrives. Do non-overlapping prep while waiting.
</Oracle_Usage>`
}

export function buildFrontendGuidanceSection(
  categories: AvailableCategory[],
): string {
  const hasVisualEngineeringCategory = categories.some(
    (category) => category.name === "visual-engineering",
  )
  if (hasVisualEngineeringCategory) {
    return ""
  }

  return `# Frontend Tasks

When you must touch frontend code yourself: avoid generic AI-SaaS aesthetics. Choose a clear visual direction with CSS variables (no purple-on-white default, no dark-mode default). Use expressive, purposeful typography rather than default stacks (Inter, Roboto, Arial, system). Build atmosphere through gradients, shapes, or subtle patterns rather than flat single-color backgrounds. Use a few meaningful animations (page-load, staggered reveals) over generic micro-motion. Verify both desktop and mobile rendering. If working within an existing design system, preserve its patterns instead.`
}

export function buildNonClaudePlannerSection(model: string): string {
  const isNonClaude = !model.toLowerCase().includes("claude")
  if (!isNonClaude) return ""

  return `### Plan Agent (Non-Claude)
Multi-step task -> consult plan agent FIRST. Never start implementation without a plan.
Single-file/trivial -> proceed directly. Otherwise: task(subagent_type="plan") first.
Use task_id to resume same plan agent. If anything ambiguous, ask plan agent before guessing.`
}

export function buildParallelDelegationSection(
  model: string,
  categories: AvailableCategory[],
): string {
  const isNonClaude = !model.toLowerCase().includes("claude")
  const hasDelegationCategory = categories.some(
    (category) => category.name === "deep" || category.name === "unspecified-high",
  )

  if (!isNonClaude || !hasDelegationCategory) {
    return ""
  }

  return `### Decompose and Delegate
Failure mode: implementing yourself instead of delegating. Subagents have domain configs,
loaded skills, tuned prompts. Always decompose into independent units. Delegate each to
deep/unspecified-high agent in parallel (run_in_background=true). Never sequential when
parallel is possible. Never implement directly when delegation fits.
Vague delegation = failed work. Each prompt needs: GOAL + success criteria + file paths +
constraints + patterns to follow + scope boundary.`
}

export function buildPonytailLadderSection(): string {
  return `<ponytail_ladder>
## Solution Ladder (stop at first rung that holds)

1. Need to exist? -> skip, say so in one line (YAGNI)
2. Already in this codebase? -> reuse, don't rewrite
3. Stdlib does it? -> use it
4. Native platform feature covers it? -> use it
5. Already-installed dependency? -> use it
6. One line? -> one line
7. Only then: minimum code that works

Lazy about solution, never about reading. Trace the flow first, then climb.
Two rungs work -> take the higher one, move on.
Bug fix = root cause, not symptom. Grep every caller, fix the shared function once.

Never cut: input validation at trust boundaries, error handling preventing data loss,
security, accessibility. Anything explicitly requested.
Shortest working diff wins, but only once you understand the problem.
No unrequested abstractions. No new dependency if avoidable. Deletion over addition.
</ponytail_ladder>`
}
