/**
 * Agent config keys to display names mapping.
 * Config keys are lowercase (e.g., "sisyphus", "atlas").
 * Display names include suffixes for UI/logs (e.g., "Sisyphus - Ultraworker").
 *
 * IMPORTANT: Display names MUST NOT contain parentheses or other characters
 * that are invalid in HTTP header values per RFC 7230. OpenCode passes the
 * agent name in the `x-opencode-agent-name` header, and parentheses cause
 * header validation failures that prevent agents from appearing in the UI
 * type selector dropdown. Use ` - ` (space-dash-space) instead of `(...)`.
 */
export const AGENT_DISPLAY_NAMES: Record<string, string> = {
  sisyphus: "orchestrator",
  hephaestus: "coder",
  prometheus: "planner",
  atlas: "coordinator",
  "sisyphus-junior": "worker",
  metis: "analyst",
  momus: "critic",
  athena: "council",
  "athena-junior": "council-worker",
  oracle: "architect",
  librarian: "librarian",
  explore: "explorer",
  "multimodal-looker": "vision",
  "council-member": "council-member",
}

const INVISIBLE_AGENT_CHARACTERS_REGEX = /[\u200B\u200C\u200D\uFEFF]/g
const VISIBLE_AGENT_LIST_SORT_PREFIX_REGEX = /^\d+\|/
const AGENT_WRAPPER_CHARS_REGEX = /^[\\/"']+|[\\/"']+$/g

export function stripInvisibleAgentCharacters(agentName: string): string {
  return agentName.replace(INVISIBLE_AGENT_CHARACTERS_REGEX, "")
}

export function stripAgentListSortPrefix(agentName: string): string {
  return stripInvisibleAgentCharacters(agentName).replace(VISIBLE_AGENT_LIST_SORT_PREFIX_REGEX, "").replace(AGENT_WRAPPER_CHARS_REGEX, "")
}

/**
 * Get display name for an agent config key.
 * Uses case-insensitive lookup for backward compatibility.
 * Returns original key if not found.
 *
 * @param overrides - Optional per-agent overrides map. If the agent has a `displayName`
 *   field set, it takes precedence over the hardcoded AGENT_DISPLAY_NAMES entry.
 *   This enables i18n: `agents.sisyphus.displayName = "总指挥"` in .omo/omo.jsonc.
 */
export function getAgentDisplayName(
  configKey: string,
  overrides?: Record<string, { displayName?: string } | undefined>,
): string {
  // Check per-agent displayName override first (i18n support)
  if (overrides) {
    const override = overrides[configKey]
      ?? Object.entries(overrides).find(([k]) => k.toLowerCase() === configKey.toLowerCase())?.[1]
    if (override?.displayName) return override.displayName
  }

  const resolved = resolveKnownAgentConfigKey(configKey)
  const lookupKey = resolved ?? configKey

  // Try exact match first
  const exactMatch = AGENT_DISPLAY_NAMES[lookupKey]
  if (exactMatch !== undefined) return exactMatch

  // Fall back to case-insensitive search
  const lowerKey = lookupKey.toLowerCase()
  for (const [k, v] of Object.entries(AGENT_DISPLAY_NAMES)) {
    if (k.toLowerCase() === lowerKey) return v
  }

  // Unknown agent: return original key
  return configKey
}

/**
 * Thin alias for `getAgentDisplayName` preserved for external imports.
 *
 * Earlier versions injected zero-width prefixes here to bias OpenCode's
 * `agent.name` sort. Sort ordering is now enforced by
 * `src/shared/agent-sort-shim.ts`, so this function emits the canonical
 * display name verbatim. Kept exported because downstream modules still
 * import this symbol; do not collapse the call sites without coordinating.
 */
export function getAgentListDisplayName(
  configKey: string,
  overrides?: Record<string, { displayName?: string } | undefined>,
): string {
  return getAgentDisplayName(configKey, overrides)
}

const REVERSE_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(AGENT_DISPLAY_NAMES).map(([key, displayName]) => [displayName.toLowerCase(), key]),
)

// Legacy display names for backward compatibility.
// Old configs/sessions may reference these names; resolve them to config keys.
const LEGACY_DISPLAY_NAMES: Record<string, string> = {
  "sisyphus (ultraworker)": "sisyphus",
  "sisyphus - ultraworker": "sisyphus",
  "sisyphus": "sisyphus",
  "hephaestus (deep agent)": "hephaestus",
  "hephaestus - deep agent": "hephaestus",
  "hephaestus": "hephaestus",
  "prometheus (plan builder)": "prometheus",
  "prometheus - plan builder": "prometheus",
  "prometheus": "prometheus",
  "atlas (plan executor)": "atlas",
  "atlas - plan executor": "atlas",
  "atlas": "atlas",
  "sisyphus-junior": "sisyphus-junior",
  "metis (plan consultant)": "metis",
  "metis - plan consultant": "metis",
  "metis": "metis",
  "momus (plan critic)": "momus",
  "momus - plan critic": "momus",
  "momus": "momus",
  "athena (council)": "athena",
  "athena - council": "athena",
  "athena": "athena",
  "athena-junior (council)": "athena-junior",
  "athena-junior - council": "athena-junior",
  "athena-junior": "athena-junior",
  "oracle": "oracle",
  "explore": "explore",
  "multimodal-looker": "multimodal-looker",
}

function resolveKnownAgentConfigKey(agentName: string): string | undefined {
  const lower = stripAgentListSortPrefix(agentName).trim().toLowerCase()
  const reversed = REVERSE_DISPLAY_NAMES[lower]
  if (reversed !== undefined) return reversed
  const legacy = LEGACY_DISPLAY_NAMES[lower]
  if (legacy !== undefined) return legacy
  if (AGENT_DISPLAY_NAMES[lower] !== undefined) return lower
  return undefined
}

/**
 * Resolve an agent name (display name or config key) to its lowercase config key.
 * "Atlas - Plan Executor" -> "atlas", "Atlas (Plan Executor)" -> "atlas", "atlas" -> "atlas"
 */
export function getAgentConfigKey(agentName: string): string {
  const lower = stripAgentListSortPrefix(agentName).trim().toLowerCase()
  return resolveKnownAgentConfigKey(agentName) ?? lower
}

/**
 * Normalize an agent name for prompt APIs.
 * - Known display names -> canonical display names
 * - Known config keys (any case) -> canonical display names
 * - Unknown/custom names -> preserved as-is (trimmed)
 */
export function normalizeAgentForPrompt(agentName: string | undefined): string | undefined {
  if (typeof agentName !== "string") {
    return undefined
  }

  const trimmed = stripAgentListSortPrefix(agentName).trim()
  if (!trimmed) {
    return undefined
  }

  const configKey = resolveKnownAgentConfigKey(trimmed)
  if (configKey !== undefined) {
    return AGENT_DISPLAY_NAMES[configKey] ?? trimmed
  }

  return trimmed
}

export function normalizeAgentForPromptKey(agentName: string | undefined): string | undefined {
  if (typeof agentName !== "string") {
    return undefined
  }

  const trimmed = stripAgentListSortPrefix(agentName).trim()
  if (!trimmed) {
    return undefined
  }

  return resolveKnownAgentConfigKey(trimmed) ?? trimmed
}
