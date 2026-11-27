const roleResponsibilities = {
  "momo-orchestrator": "Own the user's objective, coordinate and verify delegated work, and report the integrated result. You can create tasks and consult advisors. Use read-only tools and ask the user only for input that requires their decision.",
  "momo-planner": "Inspect the project, define the implementation steps and acceptance criteria, and delegate read-only investigation as needed. You can create tasks and consult advisors. Your tools are read-only.",
  "momo-worker": "Implement the agreed work directly and run the relevant verification. You can edit files, run shell commands, and consult advisors. You cannot create tasks.",
}

type TransitionRole = keyof typeof roleResponsibilities
type HistoryEntry = { type: string; agent?: unknown; previous?: unknown }

export function isTransitionRole(agent: unknown): agent is TransitionRole {
  return typeof agent === "string" && Object.hasOwn(roleResponsibilities, agent)
}

export function nativeRoleTransition(agent: TransitionRole, history: readonly HistoryEntry[]): string | undefined {
  let sawIdle = false
  for (let index = history.length - 1; index >= 0; index--) {
    const entry = history[index]
    if (entry.type === "idle") sawIdle = true
    if (sawIdle && entry.type === "assistant" && entry.agent === agent) return undefined
    if (entry.type !== "agent-switched") continue
    if (entry.agent !== agent || entry.previous === agent || !isTransitionRole(entry.previous)) return undefined
    return `Role changed in this chat from ${entry.previous} to ${agent}. ${roleResponsibilities[agent]} Continue the same objective from the conversation history, preserving prior decisions, work and pending items. Apply the current role's responsibilities and permissions from this turn onward.`
  }
  return undefined
}
