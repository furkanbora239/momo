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
    expect(tools.subagent).toBe(true)
  })

  test("#given executor with managersEnabled=true #when building tools #then task is granted", () => {
    const tools = buildSyncPromptTools("executor", undefined, true)
    expect(tools.subagent).toBe(true)
  })

  test("#given reviewer with managersEnabled=true #when building tools #then task is granted", () => {
    const tools = buildSyncPromptTools("reviewer", undefined, true)
    expect(tools.subagent).toBe(true)
  })

  test("#given manager with managersEnabled=true #when building tools #then task is granted", () => {
    const tools = buildSyncPromptTools("manager", undefined, true)
    expect(tools.subagent).toBe(true)
  })

  test("#given planner with managersEnabled=false #when building tools #then task is denied (degraded)", () => {
    const tools = buildSyncPromptTools("planner", undefined, false)
    expect(tools.subagent).toBe(false)
  })

  test("#given executor with managersEnabled=false #when building tools #then task is denied (degraded)", () => {
    const tools = buildSyncPromptTools("executor", undefined, false)
    expect(tools.subagent).toBe(false)
  })

  test("#given reviewer with managersEnabled=false #when building tools #then task is denied (degraded)", () => {
    const tools = buildSyncPromptTools("reviewer", undefined, false)
    expect(tools.subagent).toBe(false)
  })

  test("#given manager with managersEnabled=false #when building tools #then task is denied (degraded)", () => {
    const tools = buildSyncPromptTools("manager", undefined, false)
    expect(tools.subagent).toBe(false)
  })

  test("#given planner #when building tools #then edit is denied under V2 naming", () => {
    const tools = buildSyncPromptTools("planner", undefined, true)
    expect(tools.edit).toBe(false)
    expect(tools.write).toBeUndefined()
  })

  test("#given reviewer #when building tools #then edit is denied under V2 naming", () => {
    const tools = buildSyncPromptTools("reviewer", undefined, true)
    expect(tools.edit).toBe(false)
    expect(tools.write).toBeUndefined()
  })

  test("#given executor #when building tools #then edit and call_omo_agent are denied", () => {
    const tools = buildSyncPromptTools("executor", undefined, true)
    expect(tools.edit).toBe(false)
    expect(tools.call_omo_agent).toBe(false)
    expect(tools.write).toBeUndefined()
  })

  test("#given plan agent #when building tools #then task is granted (plan-family always can)", () => {
    const tools = buildSyncPromptTools("plan", undefined, false)
    expect(tools.subagent).toBe(true)
  })

  test("#given sisyphus-junior #when building tools #then task is denied (worker)", () => {
    const tools = buildSyncPromptTools("sisyphus-junior", undefined, true)
    expect(tools.subagent).toBe(false)
  })

  test("#given managersEnabled defaults to true #when building planner tools without flag #then task is granted", () => {
    const tools = buildSyncPromptTools("planner")
    expect(tools.subagent).toBe(true)
  })
})

describe("agent-tool-restrictions - manager entries", () => {
  test("#given planner #when getAgentToolRestrictions called #then edit is denied under V2 naming", () => {
    const restrictions = getAgentToolRestrictions("planner")
    expect(restrictions.edit).toBe(false)
    expect(restrictions.write).toBeUndefined()
  })

  test("#given reviewer #when getAgentToolRestrictions called #then edit is denied under V2 naming", () => {
    const restrictions = getAgentToolRestrictions("reviewer")
    expect(restrictions.edit).toBe(false)
    expect(restrictions.write).toBeUndefined()
  })

  test("#given research #when getAgentToolRestrictions called #then edit, subagent, call_omo_agent are denied", () => {
    const restrictions = getAgentToolRestrictions("research")
    expect(restrictions.edit).toBe(false)
    expect(restrictions.subagent).toBe(false)
    expect(restrictions.call_omo_agent).toBe(false)
    expect(restrictions.write).toBeUndefined()
    expect(restrictions.task).toBeUndefined()
  })

  test("#given executor #when getAgentToolRestrictions called #then edit, call_omo_agent are denied", () => {
    const restrictions = getAgentToolRestrictions("executor")
    expect(restrictions.edit).toBe(false)
    expect(restrictions.call_omo_agent).toBe(false)
    expect(restrictions.write).toBeUndefined()
  })
})

describe("manager dispatcher virtualization under Jev engine", () => {
  test("#given engine=jev #when a manager delegation is routed #then it never resolves to the LLM manager agent", async () => {
    const { createDecisionRouter } = require("./decision-router")
    const { ManagerConfigSchema } = require("../../config/schema/decision-engine")

    const engine = {
      async decide() {
        return {
          source: "jev",
          stage1: {
            path: { type: "choice", choice: "planner", confidence: 0.9, probabilities: {} },
            effort: { type: "score", score: 3, confidence: 0.9 },
          },
          candidates: [{ name: "a/b", priceLine: "$0.04/M input", strength: "fast" }],
          stage2: {
            model: { type: "choice", choice: "a/b", confidence: 0.9, probabilities: {} },
            lane: { type: "choice", choice: "direct-worker", confidence: 0.9, probabilities: {} },
          },
          resolved: { path: "planner", effort: 3, model: "a/b", lane: "direct-worker" },
          usage: { inputTokens: 10, costUsd: 0.0004 },
          latencyMs: 12,
        }
      },
    }
    const router = createDecisionRouter({
      client: {},
      config: ManagerConfigSchema.parse({}),
      ledger: {
        record: () => ({ id: "x", ts: 0 }),
        backfillOutcome: () => true,
        accumulate: () => {},
        monthlySpendUsd: () => 0,
        readAll: () => [],
      },
      engine,
      buildCandidatesImpl: () => [{ name: "a/b", priceLine: "$0.04/M input", strength: "fast" }],
    })

    const result = await router.route({ description: "t", prompt: "p" })

    expect(result.rewrite.subagent_type).toBe("planner")
    expect(result.rewrite.subagent_type).not.toBe("manager")
  })
})

module.exports = {}
