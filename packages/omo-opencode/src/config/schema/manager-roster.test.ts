const { describe, test, expect } = require("bun:test")

const { V1_DISABLED_AGENTS_DEFAULT } = require("../validate")

describe("roster ordering with managers", () => {
  test("#given V1_DISABLED_AGENTS_DEFAULT #when inspected #then does NOT include planner or executor", () => {
    expect(V1_DISABLED_AGENTS_DEFAULT).not.toContain("planner")
    expect(V1_DISABLED_AGENTS_DEFAULT).not.toContain("executor")
  })

  test("#given V1_DISABLED_AGENTS_DEFAULT #when inspected #then contains prometheus and other v1-disabled agents", () => {
    expect(V1_DISABLED_AGENTS_DEFAULT).toContain("prometheus")
    expect(V1_DISABLED_AGENTS_DEFAULT).toContain("metis")
    expect(V1_DISABLED_AGENTS_DEFAULT).toContain("momus")
  })

  test("#given BuiltinAgentNameSchema #when planner/executor values used #then they are valid enum values", async () => {
    const { BuiltinAgentNameSchema } = require("./agent-names")
    expect(BuiltinAgentNameSchema.options).toContain("planner")
    expect(BuiltinAgentNameSchema.options).toContain("executor")
  })

  test("#given OverridableAgentNameSchema #when planner/executor values used #then they are valid enum values", () => {
    const { OverridableAgentNameSchema } = require("./agent-names")
    expect(OverridableAgentNameSchema.options).toContain("planner")
    expect(OverridableAgentNameSchema.options).toContain("executor")
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
})

module.exports = {}
