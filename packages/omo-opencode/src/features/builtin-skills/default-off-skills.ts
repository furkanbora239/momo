import type { SkillsConfig } from "../../config"
import type { LoadedSkill } from "../opencode-skill-loader/types"

/**
 * momo wave-2 lean roster: skill names that stay off the agent's per-agent skill
 * listing and the `/[name]` skill commands unless the user re-enables them via
 * `skills.enable_default_off` or ships them under a project / config scope where
 * the opt-in is intentional. Heavyweight multi-agent orchestrators and shared
 * heavy prompts live here; the always-on, lightweight defaults (`frontend`,
 * `git-master`, `debugging`, `playwright`, `visual-qa`) deliberately stay out so
 * they remain surfaced.
 */
export const MOMO_DEFAULT_OFF_SKILLS = [
  "security-research",
  "security-review",
  "review-work",
  "init-deep",
  "remove-ai-slops",
  "data-scientist",
  "ulw-plan",
  "ulw-research",
  "ultimate-browsing",
  "refactor",
  "hyperplan",
] as const

const DEFAULT_OFF_NAMES_SET = new Set<string>(
  MOMO_DEFAULT_OFF_SKILLS.map((name) => name.toLowerCase()),
)

/**
 * Scopes whose skills are subject to the default-off filter. Project,
 * opencode-project, and config scopes hold user-intentional local overrides and
 * are exempt.
 */
const GLOBAL_DEFAULT_OFF_SCOPES: ReadonlySet<string> = new Set([
  "builtin",
  "shared",
  "user",
  "opencode",
])

/**
 * Returns true when `name` matches a default-off skill name (case-insensitive)
 * and the caller has not exempted it via `enableList`. An absent OR empty
 * enable list suppresses every default-off name uniformly.
 */
export function isDefaultOffSkillName(
  name: string,
  enableList?: readonly string[],
): boolean {
  if (!DEFAULT_OFF_NAMES_SET.has(name.toLowerCase())) return false
  if (enableList === undefined || enableList.length === 0) return true
  const normalized = name.toLowerCase()
  return !enableList.some((entry) => entry.toLowerCase() === normalized)
}

/**
 * Drops default-off names from `skills` when they originate from a global scope
 * (`builtin`, `shared`, `user`, `opencode`). Project, opencode-project, and
 * config scopes are exempt (user opted in locally). Names listed in
 * `enableList` survive everywhere.
 */
export function applyDefaultOffSkillFilter(
  skills: LoadedSkill[],
  enableList?: readonly string[],
): LoadedSkill[] {
  if (skills.length === 0) return skills
  return skills.filter((skill) => {
    if (!GLOBAL_DEFAULT_OFF_SCOPES.has(skill.scope)) return true
    return !isDefaultOffSkillName(skill.name, enableList)
  })
}

/**
 * Reads `skills.enable_default_off` from the object form of the skills config.
 * Returns `undefined` for the array-form config, an absent `enable_default_off`
 * field, an undefined config, or any non-array payload so callers can
 * distinguish "user did not opt in" from "user opted into an empty exemption
 * list".
 */
export function getEnableDefaultOffList(
  skills: SkillsConfig | undefined,
): readonly string[] | undefined {
  if (skills === undefined) return undefined
  if (Array.isArray(skills)) return undefined
  if (typeof skills !== "object" || skills === null) return undefined
  const value = (skills as { enable_default_off?: unknown }).enable_default_off
  if (!Array.isArray(value)) return undefined
  return value.filter((item): item is string => typeof item === "string")
}
