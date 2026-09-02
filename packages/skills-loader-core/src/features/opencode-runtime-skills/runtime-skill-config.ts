import { isPlainRecord } from "@oh-my-opencode/utils"
import type { RuntimeSkillConfig } from "../../types"
import { securityResearchSkill, securityReviewSkill } from "../builtin-skills/skills/index"
import { collectDisabledSkillAliases } from "../opencode-skill-loader/skill-disable-config"
import { createOpenCodeSkillMarkdown, type OpenCodeSkillMarkdown } from "./skill-markdown"

export type RuntimeSkillSourceEntry = OpenCodeSkillMarkdown

export type OpenCodeSkillsHostConfig = {
  readonly paths?: readonly string[]
  readonly urls?: readonly string[]
  readonly [key: string]: unknown
}

export type OpenCodeSkillHostConfig = Record<string, unknown> & {
  skills?: OpenCodeSkillsHostConfig
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === "string")
}

function appendUnique(values: readonly string[], next: string): string[] {
  if (values.includes(next)) return [...values]
  return [...values, next]
}

function isEnableDefaultOffListed(skillName: string, skills: unknown): boolean {
  if (!isPlainRecord(skills)) return false
  const enableDefaultOff = skills.enable_default_off
  if (!Array.isArray(enableDefaultOff)) return false
  const normalized = skillName.toLowerCase()
  return enableDefaultOff.some((entry) => typeof entry === "string" && entry.toLowerCase() === normalized)
}

export function selectRuntimeSecuritySkills(
  pluginConfig: RuntimeSkillConfig = {},
): RuntimeSkillSourceEntry[] {
  const disabledSkills = collectDisabledSkillAliases(pluginConfig)
  const includeResearch =
    isEnableDefaultOffListed("security-research", pluginConfig.skills)
    && !disabledSkills.has("security-research")
  const includeReview =
    isEnableDefaultOffListed("security-review", pluginConfig.skills)
    && !disabledSkills.has("security-review")
  if (!includeResearch && !includeReview) return []

  const skills = []
  if (includeResearch) {
    skills.push(securityResearchSkill)
  }
  if (includeReview) {
    skills.push(securityReviewSkill)
  }

  return skills.map((skill) => createOpenCodeSkillMarkdown(skill))
}

export function applyRuntimeSkillSourceConfig(params: {
  readonly config: OpenCodeSkillHostConfig
  readonly pluginConfig: RuntimeSkillConfig
  readonly sourceUrl: string
}): void {
  if (selectRuntimeSecuritySkills(params.pluginConfig).length === 0) return

  const existingSkills = isPlainRecord(params.config.skills) ? params.config.skills : {}
  const existingUrls = toStringList(existingSkills.urls)
  const nextUrls = appendUnique(existingUrls, params.sourceUrl)

  params.config.skills = {
    ...existingSkills,
    urls: nextUrls,
  }
}
