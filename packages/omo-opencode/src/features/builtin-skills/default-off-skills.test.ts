/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"
import type { LoadedSkill, SkillScope } from "../opencode-skill-loader/types"
import {
  applyDefaultOffSkillFilter,
  getEnableDefaultOffList,
  isDefaultOffSkillName,
  MOMO_DEFAULT_OFF_SKILLS,
} from "./default-off-skills"

function makeSkill(name: string, scope: SkillScope): LoadedSkill {
  return {
    name,
    resolvedPath: `/test/skills/${name}`,
    definition: {
      name,
      description: `Skill ${name}`,
      template: "",
    },
    scope,
  }
}

describe("MOMO_DEFAULT_OFF_SKILLS", () => {
  it("contains the wave-2 roster and keeps default-on skills out", () => {
    // given / when
    const roster = new Set<string>(MOMO_DEFAULT_OFF_SKILLS)

    // then
    expect(roster.has("security-research")).toBe(true)
    expect(roster.has("ultimate-browsing")).toBe(true)
    expect(roster.has("frontend")).toBe(false)
    expect(roster.has("debugging")).toBe(false)
    expect(roster.has("playwright")).toBe(false)
  })
})

describe("applyDefaultOffSkillFilter", () => {
  it("filters default-off skills from plugin and shared scopes", () => {
    // given
    const skills = [
      makeSkill("security-research", "builtin"),
      makeSkill("ulw-plan", "shared"),
      makeSkill("frontend", "builtin"),
    ]

    // when
    const result = applyDefaultOffSkillFilter(skills)

    // then
    expect(result.map((skill) => skill.name)).toEqual(["frontend"])
  })

  it("filters default-off skills from user-global scopes (user, opencode)", () => {
    // given
    const skills = [
      makeSkill("review-work", "user"),
      makeSkill("data-scientist", "opencode"),
      makeSkill("debugging", "user"),
    ]

    // when
    const result = applyDefaultOffSkillFilter(skills)

    // then
    expect(result.map((skill) => skill.name)).toEqual(["debugging"])
  })

  it("keeps project-scope skills that share a default-off name", () => {
    // given
    const skills = [
      makeSkill("review-work", "project"),
      makeSkill("ulw-research", "opencode-project"),
    ]

    // when
    const result = applyDefaultOffSkillFilter(skills)

    // then
    expect(result.map((skill) => skill.name)).toEqual(["review-work", "ulw-research"])
  })

  it("keeps config-scope skills that share a default-off name", () => {
    // given
    const skills = [makeSkill("refactor", "config")]

    // when
    const result = applyDefaultOffSkillFilter(skills)

    // then
    expect(result.map((skill) => skill.name)).toEqual(["refactor"])
  })

  it("exempts enable-listed default-off skills", () => {
    // given
    const skills = [
      makeSkill("security-research", "builtin"),
      makeSkill("security-review", "builtin"),
    ]

    // when
    const result = applyDefaultOffSkillFilter(skills, ["security-research"])

    // then
    expect(result.map((skill) => skill.name)).toEqual(["security-research"])
  })

  it("keeps every skill when the enable list covers the roster", () => {
    // given
    const skills = [makeSkill("review-work", "shared"), makeSkill("init-deep", "builtin")]

    // when
    const result = applyDefaultOffSkillFilter(skills, ["review-work", "init-deep"])

    // then
    expect(result.map((skill) => skill.name)).toEqual(["review-work", "init-deep"])
  })

  it("returns an empty list without crashing", () => {
    // given / when / then
    expect(applyDefaultOffSkillFilter([])).toEqual([])
    expect(applyDefaultOffSkillFilter([], ["review-work"])).toEqual([])
  })
})

describe("isDefaultOffSkillName", () => {
  it("matches default-off names case-insensitively", () => {
    // given / when / then
    expect(isDefaultOffSkillName("Review-Work")).toBe(true)
    expect(isDefaultOffSkillName("review-work")).toBe(true)
    expect(isDefaultOffSkillName("frontend")).toBe(false)
  })

  it("treats the enable list as an exemption", () => {
    // given / when / then
    expect(isDefaultOffSkillName("review-work", ["REVIEW-WORK"])).toBe(false)
    expect(isDefaultOffSkillName("review-work", ["init-deep"])).toBe(true)
    expect(isDefaultOffSkillName("review-work", [])).toBe(true)
  })
})

describe("getEnableDefaultOffList", () => {
  it("reads enable_default_off from the skills object config", () => {
    // given / when / then
    expect(getEnableDefaultOffList({ enable_default_off: ["review-work"] })).toEqual(["review-work"])
  })

  it("returns undefined for absent field, absent config, and array-form config", () => {
    // given / when / then
    expect(getEnableDefaultOffList(undefined)).toBeUndefined()
    expect(getEnableDefaultOffList({ sources: [] })).toBeUndefined()
    expect(getEnableDefaultOffList(["review-work"])).toBeUndefined()
  })
})
