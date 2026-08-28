import type {
  AvailableAgent,
  AvailableCategory,
  AvailableSkill,
} from "./dynamic-agent-prompt-types"

export function buildHardBlocksSection(): string {
  const blocks = [
    "- Type error suppression (`as any`, `@ts-ignore`) - **Never**",
    "- Commit without explicit request - **Never**",
    "- Speculate about unread code - **Never**",
    "- Leave code in broken state after failures - **Never**",
    "- `background_cancel(all=true)` - **Never.** Always cancel individually by taskId.",
    "- Delivering final answer before collecting Oracle result - **Never.**",
  ]

  return `## Hard Blocks (NEVER violate)

${blocks.join("\n")}`
}

export function buildAntiPatternsSection(): string {
  const patterns = [
    "- **Type Safety**: `as any`, `@ts-ignore`, `@ts-expect-error`",
    "- **Error Handling**: Empty catch blocks `catch(e) {}`",
    '- **Testing**: Deleting failing tests to "pass"',
    "- **Search**: Firing agents for single-line typos or obvious syntax errors",
    "- **Debugging**: Shotgun debugging, random changes",
    "- **Background Tasks**: Polling `background_output` on running tasks - end response and wait for notification",
    "- **Delegation Duplication**: Delegating exploration to explore/librarian and then manually doing the same search yourself",
    "- **Oracle**: Delivering answer without collecting Oracle results",
  ]

  return `## Anti-Patterns (BLOCKING violations)

${patterns.join("\n")}`
}

export function buildToolCallFormatSection(): string {
  return `## Tool Call Format
Use native tool calling. Never output tool calls as text. Never write JSON in your response.
The system handles formatting automatically.`
}

export function buildUltraworkSection(
  agents: AvailableAgent[],
  categories: AvailableCategory[],
  skills: AvailableSkill[],
): string {
  const lines: string[] = []

  if (categories.length > 0) {
    lines.push("**Categories** (for implementation tasks):")
    for (const category of categories) {
      const shortDescription = category.description || category.name
      lines.push(`- \`${category.name}\`: ${shortDescription}`)
    }
    lines.push("")
  }

  if (skills.length > 0) {
    const builtinSkills = skills.filter((skill) => skill.location === "plugin")
    const customSkills = skills.filter((skill) => skill.location !== "plugin")

    if (builtinSkills.length > 0) {
      lines.push("**Built-in Skills** (combine with categories):")
      for (const skill of builtinSkills) {
        const shortDescription = skill.description.split(".")[0] || skill.description
        lines.push(`- \`${skill.name}\`: ${shortDescription}`)
      }
      lines.push("")
    }

    if (customSkills.length > 0) {
      lines.push("**User-Installed Skills** (HIGH PRIORITY - user installed these for their workflow):")
      for (const skill of customSkills) {
        const shortDescription = skill.description.split(".")[0] || skill.description
        lines.push(`- \`${skill.name}\`: ${shortDescription}`)
      }
      lines.push("")
    }
  }

  if (agents.length > 0) {
    const ultraworkAgentPriority = ["explore", "librarian", "plan", "oracle"]
    const sortedAgents = [...agents].sort((left, right) => {
      const leftIndex = ultraworkAgentPriority.indexOf(left.name)
      const rightIndex = ultraworkAgentPriority.indexOf(right.name)
      if (leftIndex === -1 && rightIndex === -1) {
        return 0
      }
      if (leftIndex === -1) {
        return 1
      }
      if (rightIndex === -1) {
        return -1
      }
      return leftIndex - rightIndex
    })

    lines.push("**Agents** (for specialized consultation/exploration):")
    for (const agent of sortedAgents) {
      const shortDescription =
        agent.description.length > 120
          ? `${agent.description.slice(0, 120)}...`
          : agent.description
      const suffix =
        agent.name === "explore" || agent.name === "librarian" ? " (multiple)" : ""
      lines.push(`- \`${agent.name}${suffix}\`: ${shortDescription}`)
    }
  }

  return lines.join("\n")
}

export function buildAntiDuplicationSection(): string {
  return `<Anti_Duplication>
## Anti-Duplication (CRITICAL)
After delegating to explore/librarian, do NOT redo that search yourself.
Allowed: non-overlapping work, unrelated files, independent prep.
When waiting for delegated results: end response, wait for notification, then collect
via background_output(task_id="bg_..."). Do NOT re-search while waiting.
Duplicate exploration wastes tokens and risks contradicting agent findings.
</Anti_Duplication>`
}
