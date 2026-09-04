const { describe, test, expect } = require("bun:test")

const { canSpawnWorkers, isManagerAgent, isDispatcherAgent, MANAGER_AGENT_NAMES } = require("./constants")
const { buildSyncPromptTools } = require("./sync-prompt-sender")
const { getAgentToolRestrictions } = require("../../shared/agent-tool-restrictions")

describe("canSpawnWorkers", () => {
  test("#given plan-family agent #when canSpawnWorkers called #then returns true regardless of managersEnabled", () => {
    expect(canSpawnWorkers("plan", false)).toBe(true)
    expect(canSpawnWorkers("prometheus", true)).toBe(true)
  })

  test("#given manager agent with managersEnabled=true #when canSpawnWorkers called #then returns true", () => {
    expect(canSpawnWorkers("planner", true)).toBe(true)
    expect(canSpawnWorkers("executor", true)).toBe(true)
    expect(canSpawnWorkers("reviewer", true)).toBe(true)
    expect(canSpawnWorkers("manager", true)).toBe(true)
  })

  test("#given manager agent with managersEnabled=false #when canSpawnWorkers called #then returns false (degraded)", () => {
    expect(canSpawnWorkers("planner", false)).toBe(false)
    expect(canSpawnWorkers("executor", false)).toBe(false)
    expect(canSpawnWorkers("reviewer", false)).toBe(false)
    expect(canSpawnWorkers("manager", false)).toBe(false)
  })

  test("#given non-manager non-plan agent #when canSpawnWorkers called #then returns false", () => {
    expect(canSpawnWorkers("sisyphus", true)).toBe(false)
    expect(canSpawnWorkers("explore", true)).toBe(false)
    expect(canSpawnWorkers("oracle", true)).toBe(false)
    expect(canSpawnWorkers("research", true)).toBe(false)
  })

  test("#given undefined agent #when canSpawnWorkers called #then returns false", () => {
    expect(canSpawnWorkers(undefined, true)).toBe(false)
  })

  test("#given managersEnabled defaults to true #when canSpawnWorkers called without second arg #then manager returns true", () => {
    expect(canSpawnWorkers("planner")).toBe(true)
    expect(canSpawnWorkers("executor")).toBe(true)
    expect(canSpawnWorkers("reviewer")).toBe(true)
  })
})

describe("isManagerAgent", () => {
  test("#given planner, executor, and reviewer #when isManagerAgent called #then returns true", () => {
    expect(isManagerAgent("planner")).toBe(true)
    expect(isManagerAgent("executor")).toBe(true)
    expect(isManagerAgent("reviewer")).toBe(true)
  })

  test("#given non-manager agent #when isManagerAgent called #then returns false", () => {
    expect(isManagerAgent("sisyphus")).toBe(false)
    expect(isManagerAgent("plan")).toBe(false)
    expect(isManagerAgent("research")).toBe(false)
    expect(isManagerAgent(undefined)).toBe(false)
  })

  test("#given MANAGER_AGENT_NAMES #when inspected #then contains planner, executor, and reviewer", () => {
    expect(MANAGER_AGENT_NAMES).toEqual(["planner", "executor", "reviewer"])
  })
})

describe("buildSyncPromptTools - manager tool grant matrix", () => {
  test("#given planner with managersEnabled=true #when building tools #then task is granted", () => {
    const tools = buildSyncPromptTools("planner", undefined, true)
    expect(tools.task).toBe(true)
  })

  test("#given executor with managersEnabled=true #when building tools #then task is granted", () => {
    const tools = buildSyncPromptTools("executor", undefined, true)
    expect(tools.task).toBe(true)
  })

  test("#given reviewer with managersEnabled=true #when building tools #then task is granted", () => {
    const tools = buildSyncPromptTools("reviewer", undefined, true)
    expect(tools.task).toBe(true)
  })

  test("#given manager with managersEnabled=true #when building tools #then task is granted", () => {
    const tools = buildSyncPromptTools("manager", undefined, true)
    expect(tools.task).toBe(true)
  })

  test("#given planner with managersEnabled=false #when building tools #then task is denied (degraded)", () => {
    const tools = buildSyncPromptTools("planner", undefined, false)
    expect(tools.task).toBe(false)
  })

  test("#given executor with managersEnabled=false #when building tools #then task is denied (degraded)", () => {
    const tools = buildSyncPromptTools("executor", undefined, false)
    expect(tools.task).toBe(false)
  })

  test("#given reviewer with managersEnabled=false #when building tools #then task is denied (degraded)", () => {
    const tools = buildSyncPromptTools("reviewer", undefined, false)
    expect(tools.task).toBe(false)
  })

  test("#given manager with managersEnabled=false #when building tools #then task is denied (degraded)", () => {
    const tools = buildSyncPromptTools("manager", undefined, false)
    expect(tools.task).toBe(false)
  })

  test("#given planner #when building tools #then write and edit are denied", () => {
    const tools = buildSyncPromptTools("planner", undefined, true)
    expect(tools.write).toBe(false)
    expect(tools.edit).toBe(false)
  })

  test("#given reviewer #when building tools #then write and edit are denied", () => {
    const tools = buildSyncPromptTools("reviewer", undefined, true)
    expect(tools.write).toBe(false)
    expect(tools.edit).toBe(false)
  })

  test("#given executor #when building tools #then write, edit, and call_omo_agent are denied", () => {
    const tools = buildSyncPromptTools("executor", undefined, true)
    expect(tools.write).toBe(false)
    expect(tools.edit).toBe(false)
    expect(tools.call_omo_agent).toBe(false)
  })

  test("#given plan agent #when building tools #then task is granted (plan-family always can)", () => {
    const tools = buildSyncPromptTools("plan", undefined, false)
    expect(tools.task).toBe(true)
  })

  test("#given sisyphus-junior #when building tools #then task is denied (worker)", () => {
    const tools = buildSyncPromptTools("sisyphus-junior", undefined, true)
    expect(tools.task).toBe(false)
  })

  test("#given managersEnabled defaults to true #when building planner tools without flag #then task is granted", () => {
    const tools = buildSyncPromptTools("planner")
    expect(tools.task).toBe(true)
  })
})

describe("agent-tool-restrictions - manager entries", () => {
  test("#given planner #when getAgentToolRestrictions called #then write and edit are false", () => {
    const restrictions = getAgentToolRestrictions("planner")
    expect(restrictions.write).toBe(false)
    expect(restrictions.edit).toBe(false)
  })

  test("#given reviewer #when getAgentToolRestrictions called #then write and edit are false", () => {
    const restrictions = getAgentToolRestrictions("reviewer")
    expect(restrictions.write).toBe(false)
    expect(restrictions.edit).toBe(false)
  })

  test("#given research #when getAgentToolRestrictions called #then write, edit, task, call_omo_agent are false", () => {
    const restrictions = getAgentToolRestrictions("research")
    expect(restrictions.write).toBe(false)
    expect(restrictions.edit).toBe(false)
    expect(restrictions.task).toBe(false)
    expect(restrictions.call_omo_agent).toBe(false)
  })

  test("#given executor #when getAgentToolRestrictions called #then write, edit, call_omo_agent are false", () => {
    const restrictions = getAgentToolRestrictions("executor")
    expect(restrictions.write).toBe(false)
    expect(restrictions.edit).toBe(false)
    expect(restrictions.call_omo_agent).toBe(false)
  })
})

module.exports = {}
