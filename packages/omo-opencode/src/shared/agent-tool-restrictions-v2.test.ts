import { describe, test, expect } from "bun:test"
import {
  V1_TO_V2_TOOL_NAME,
  normalizeToolName,
  normalizeToolRecord,
  WORKER_READ_SIDE_TOOLS,
  getAgentToolRestrictions,
  hasAgentToolRestrictions,
} from "./agent-tool-restrictions"

describe("V2 tool name mapping", () => {
  test("maps V1 tool names to V2 equivalents", () => {
    // given/when/then
    expect(V1_TO_V2_TOOL_NAME.bash).toBe("shell")
    expect(V1_TO_V2_TOOL_NAME.task).toBe("subagent")
    expect(V1_TO_V2_TOOL_NAME.write).toBe("edit")
    expect(V1_TO_V2_TOOL_NAME.patch).toBe("edit")
    expect(V1_TO_V2_TOOL_NAME.apply_patch).toBe("edit")
  })

  test("normalizeToolName passes through unknown names", () => {
    // given/when/then
    expect(normalizeToolName("edit")).toBe("edit")
    expect(normalizeToolName("shell")).toBe("shell")
    expect(normalizeToolName("call_omo_agent")).toBe("call_omo_agent")
  })

  test("normalizeToolRecord remaps every key", () => {
    // given
    const record = { bash: false, task: true, write: false, read: true }

    // when
    const result = normalizeToolRecord(record)

    // then
    expect(result).toEqual({ shell: false, subagent: true, edit: false, read: true })
    expect(result.bash).toBeUndefined()
    expect(result.task).toBeUndefined()
    expect(result.write).toBeUndefined()
  })
})

describe("getAgentToolRestrictions under V2 semantics", () => {
  test("emits V2 names, never stale V1 names", () => {
    // given/when
    const restrictions = getAgentToolRestrictions("explore")

    // then
    expect(restrictions.subagent).toBe(false)
    expect(restrictions.edit).toBe(false)
    expect(restrictions.call_omo_agent).toBe(false)
    expect(restrictions.task).toBeUndefined()
    expect(restrictions.write).toBeUndefined()
  })

  test("still denies team tools for a delegated subagent", () => {
    // given/when
    const restrictions = getAgentToolRestrictions("librarian")

    // then
    expect(restrictions.team_create).toBe(false)
    expect(restrictions.team_list).toBe(false)
  })

  test("keeps team tools out when denylist is disabled", () => {
    // given/when
    const restrictions = getAgentToolRestrictions("librarian", { includeTeamToolDenylist: false })

    // then
    expect(restrictions.team_create).toBeUndefined()
  })
})

describe("worker baseline read-side surface", () => {
  test("execution agents positively include codegraph, skill, websearch, webfetch", () => {
    // given/when
    const worker = getAgentToolRestrictions("sisyphus-junior", { includeTeamToolDenylist: false })
    const executor = getAgentToolRestrictions("executor", { includeTeamToolDenylist: false })

    // then
    for (const agent of [worker, executor]) {
      expect(agent.codegraph_search).toBe(true)
      expect(agent.codegraph_explore).toBe(true)
      expect(agent.codegraph_context).toBe(true)
      expect(agent.skill).toBe(true)
      expect(agent.skill_mcp).toBe(true)
      expect(agent.websearch).toBe(true)
      expect(agent.webfetch).toBe(true)
    }
  })

  test("worker display alias resolves to the same baseline as sisyphus-junior", () => {
    // given/when
    const viaAlias = getAgentToolRestrictions("worker", { includeTeamToolDenylist: false })
    const viaKey = getAgentToolRestrictions("sisyphus-junior", { includeTeamToolDenylist: false })

    // then
    expect(viaAlias).toEqual(viaKey)
    expect(viaAlias.subagent).toBe(false)
    expect(viaAlias.codegraph_search).toBe(true)
  })

  test("read-only agents do not receive the worker baseline", () => {
    // given/when
    const explore = getAgentToolRestrictions("explore", { includeTeamToolDenylist: false })

    // then
    expect(explore.codegraph_search).toBeUndefined()
    expect(explore.skill).toBeUndefined()
    expect(explore.websearch).toBeUndefined()
  })

  test("baseline never overrides an explicit deny", () => {
    // given/when - executor explicitly denies edit
    const executor = getAgentToolRestrictions("executor", { includeTeamToolDenylist: false })

    // then (edit stays denied; baseline only fills undefined slots)
    expect(executor.edit).toBe(false)
    expect(WORKER_READ_SIDE_TOOLS).not.toContain("edit")
  })
})

describe("hasAgentToolRestrictions", () => {
  test("is true for an agent with denials or allows", () => {
    // given/when/then
    expect(hasAgentToolRestrictions("explore")).toBe(true)
    expect(hasAgentToolRestrictions("sisyphus-junior")).toBe(true)
  })

  test("getAgentToolRestrictions is empty for an unknown agent with the team denylist off", () => {
    // given/when/then
    expect(getAgentToolRestrictions("does-not-exist", { includeTeamToolDenylist: false })).toEqual({})
  })
})
