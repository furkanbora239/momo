import {
  getAgentConfigKey,
  getAgentDisplayName,
} from "../shared/agent-display-names"

const PARENTHETICAL_SUFFIX_PATTERN = /\s*(\([^)]*\)\s*)+$/u
const DASH_SUFFIX_PATTERN = /\s+-\s+.+$/u
const ZERO_WIDTH_CHARACTERS_PATTERN = /[\u200B\u200C\u200D\uFEFF]/g

export function normalizeProtectedAgentName(agentName: string): string {
  return agentName
    .replace(ZERO_WIDTH_CHARACTERS_PATTERN, "")
    .trim()
    .toLowerCase()
    .replace(PARENTHETICAL_SUFFIX_PATTERN, "")
    .replace(DASH_SUFFIX_PATTERN, "")
    .replace(/[-_]/g, "")
    .trim()
}

export function createProtectedAgentNameSet(agentNames: Iterable<string>): Set<string> {
  const protectedAgentNames = new Set<string>()

  for (const agentName of agentNames) {
    const normalized = normalizeProtectedAgentName(agentName)
    if (normalized.length > 0) {
      protectedAgentNames.add(normalized)
    }

    const displayName = getAgentDisplayName(agentName)
    if (displayName) {
      const normalizedDisplay = normalizeProtectedAgentName(displayName)
      if (normalizedDisplay.length > 0) {
        protectedAgentNames.add(normalizedDisplay)
      }
    }

    const configKey = getAgentConfigKey(agentName)
    if (configKey) {
      const normalizedKey = normalizeProtectedAgentName(configKey)
      if (normalizedKey.length > 0) {
        protectedAgentNames.add(normalizedKey)
      }
      const configKeyDisplay = getAgentDisplayName(configKey)
      if (configKeyDisplay) {
        const normalizedConfigKeyDisplay = normalizeProtectedAgentName(configKeyDisplay)
        if (normalizedConfigKeyDisplay.length > 0) {
          protectedAgentNames.add(normalizedConfigKeyDisplay)
        }
      }
    }
  }

  return protectedAgentNames
}

export function filterProtectedAgentOverrides<TAgent>(
  agents: Record<string, TAgent>,
  protectedAgentNames: ReadonlySet<string>,
): Record<string, TAgent> {
  return Object.fromEntries(
    Object.entries(agents).filter(([agentName]) => {
      const normalized = normalizeProtectedAgentName(agentName)
      if (protectedAgentNames.has(normalized)) return false
      const configKey = getAgentConfigKey(agentName)
      if (configKey && protectedAgentNames.has(normalizeProtectedAgentName(configKey))) {
        return false
      }
      return true
    }),
  )
}
