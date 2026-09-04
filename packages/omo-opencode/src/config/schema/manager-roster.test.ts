const { describe, test, expect } = require("bun:test")

const { V1_DISABLED_AGENTS_DEFAULT } = require("../validate")

describe("roster ordering with managers", () => {
  test("#given V1_DISABLED_AGENTS_DEFAULT #when inspected #then does NOT include planner, executor, reviewer, or research", () => {
    expect(V1_DISABLED_AGENTS_DEFAULT).not.toContain("planner")
    expect(V1_DISABLED_AGENTS_DEFAULT).not.toContain("executor")
    expect(V1_DISABLED_AGENTS_DEFAULT).not.toContain("reviewer")
    expect(V1_DISABLED_AGENTS_DEFAULT).not.toContain("research")
  })

  test("#given V1_DISABLED_AGENTS_DEFAULT #when inspected #then contains prometheus and other v1-disabled agents", () => {
    expect(V1_DISABLED_AGENTS_DEFAULT).toContain("prometheus")
    expect(V1_DISABLED_AGENTS_DEFAULT).toContain("metis")
    expect(V1_DISABLED_AGENTS_DEFAULT).toContain("momus")
  })

  test("#given BuiltinAgentNameSchema #when manager/lead/worker values used #then they are valid enum values", async () => {
    const { BuiltinAgentNameSchema } = require("./agent-names")
    expect(BuiltinAgentNameSchema.options).toContain("planner")
    expect(BuiltinAgentNameSchema.options).toContain("executor")
    expect(BuiltinAgentNameSchema.options).toContain("reviewer")
    expect(BuiltinAgentNameSchema.options).toContain("research")
  })

  test("#given OverridableAgentNameSchema #when manager/lead/worker values used #then they are valid enum values", () => {
    const { OverridableAgentNameSchema } = require("./agent-names")
    expect(OverridableAgentNameSchema.options).toContain("planner")
    expect(OverridableAgentNameSchema.options).toContain("executor")
    expect(OverridableAgentNameSchema.options).toContain("reviewer")
    expect(OverridableAgentNameSchema.options).toContain("research")
  })

  test("#given AgentOverridesSchema #when parsing with planner override #then accepts it", () => {
    const { AgentOverridesSchema } = require("./agent-overrides")
    const result = AgentOverridesSchema.safeParse({ planner: { model: "test/model" } })
    expect(result.success).toBe(true)
  })

  test("#given AgentOverridesSchema #when parsing with executor override #then accepts it", () => {
    const { AgentOverridesSchema } = require("./agent-overrides")
    const result = AgentOverridesSchema.safeParse({ executor: { model: "test/model" } })
    expect(result.success).toBe(true)
  })

  test("#given AgentOverridesSchema #when parsing with reviewer override #then accepts it", () => {
    const { AgentOverridesSchema } = require("./agent-overrides")
    const result = AgentOverridesSchema.safeParse({ reviewer: { model: "test/model" } })
    expect(result.success).toBe(true)
  })

  test("#given AgentOverridesSchema #when parsing with research override #then accepts it", () => {
    const { AgentOverridesSchema } = require("./agent-overrides")
    const result = AgentOverridesSchema.safeParse({ research: { model: "test/model" } })
    expect(result.success).toBe(true)
  })
})

module.exports = {}
