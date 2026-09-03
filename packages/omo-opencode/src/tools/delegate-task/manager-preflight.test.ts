const { describe, test, expect } = require("bun:test")

const { validateSubagentRequest } = require("./subagent-request-preflight")
const { MANAGER_AGENT_NAMES } = require("./constants")

function makeOptions() {
  return { allowSisyphusJuniorDirect: false }
}

describe("subagent-request-preflight - manager loop protection", () => {
  test("#given parent=planner and target=executor #when validating #then blocked (manager-to-manager)", () => {
    const result = validateSubagentRequest(
      { subagent_type: "executor", prompt: "do it", load_skills: [], run_in_background: false, description: "test" },
      "planner",
      "",
      makeOptions(),
    )
    expect(result.kind).toBe("invalid")
    expect(result.result.error).toContain("manager")
  })

  test("#given parent=executor and target=planner #when validating #then blocked (manager-to-manager)", () => {
    const result = validateSubagentRequest(
      { subagent_type: "planner", prompt: "plan it", load_skills: [], run_in_background: false, description: "test" },
      "executor",
      "",
      makeOptions(),
    )
    expect(result.kind).toBe("invalid")
    expect(result.result.error).toContain("manager")
  })

  test("#given parent=planner and target=prometheus #when validating #then blocked (manager-to-coordinator)", () => {
    const result = validateSubagentRequest(
      { subagent_type: "prometheus", prompt: "plan it", load_skills: [], run_in_background: false, description: "test" },
      "planner",
      "",
      makeOptions(),
    )
    expect(result.kind).toBe("invalid")
    expect(result.result.error).toContain("coordinator")
  })

  test("#given parent=executor and target=prometheus #when validating #then blocked (manager-to-coordinator)", () => {
    const result = validateSubagentRequest(
      { subagent_type: "prometheus", prompt: "plan it", load_skills: [], run_in_background: false, description: "test" },
      "executor",
      "",
      makeOptions(),
    )
    expect(result.kind).toBe("invalid")
    expect(result.result.error).toContain("coordinator")
  })

  test("#given parent=planner and target=plan #when validating #then passes (manager-to-worker, plan is not a manager family)", () => {
    const result = validateSubagentRequest(
      { subagent_type: "plan", prompt: "plan it", load_skills: [], run_in_background: false, description: "test" },
      "planner",
      "",
      makeOptions(),
    )
    expect(result.kind).toBe("valid")
  })

  test("#given parent=planner and target=explore #when validating #then passes (manager-to-worker allowed)", () => {
    const result = validateSubagentRequest(
      { subagent_type: "explore", prompt: "search", load_skills: [], run_in_background: false, description: "test" },
      "planner",
      "",
      makeOptions(),
    )
    expect(result.kind).toBe("valid")
  })

  test("#given parent=executor and target=hephaestus #when validating #then passes (manager-to-worker allowed)", () => {
    const result = validateSubagentRequest(
      { subagent_type: "hephaestus", prompt: "build", load_skills: [], run_in_background: false, description: "test" },
      "executor",
      "",
      makeOptions(),
    )
    expect(result.kind).toBe("valid")
  })

  test("#given parent=sisyphus and target=planner #when validating #then passes (orchestrator-to-manager allowed)", () => {
    const result = validateSubagentRequest(
      { subagent_type: "planner", prompt: "plan it", load_skills: [], run_in_background: false, description: "test" },
      "sisyphus",
      "",
      makeOptions(),
    )
    expect(result.kind).toBe("valid")
  })

  test("#given parent=sisyphus and target=executor #when validating #then passes (orchestrator-to-manager allowed)", () => {
    const result = validateSubagentRequest(
      { subagent_type: "executor", prompt: "execute it", load_skills: [], run_in_background: false, description: "test" },
      "sisyphus",
      "",
      makeOptions(),
    )
    expect(result.kind).toBe("valid")
  })

  test("#given parent=undefined and target=planner #when validating #then passes (no parent constraint)", () => {
    const result = validateSubagentRequest(
      { subagent_type: "planner", prompt: "plan it", load_skills: [], run_in_background: false, description: "test" },
      undefined,
      "",
      makeOptions(),
    )
    expect(result.kind).toBe("valid")
  })

  test("#given MANAGER_AGENT_NAMES #when inspected #then contains exactly planner and executor", () => {
    expect([...MANAGER_AGENT_NAMES]).toEqual(["planner", "executor"])
  })

  test("#given parent=manager and target=planner #when validating #then passes (dispatcher-to-lead)", () => {
    const result = validateSubagentRequest(
      { subagent_type: "planner", prompt: "plan it", load_skills: [], run_in_background: false, description: "test" },
      "manager",
      "",
      makeOptions(),
    )
    expect(result.kind).toBe("valid")
  })

  test("#given parent=manager and target=executor #when validating #then passes (dispatcher-to-lead)", () => {
    const result = validateSubagentRequest(
      { subagent_type: "executor", prompt: "execute it", load_skills: [], run_in_background: false, description: "test" },
      "manager",
      "",
      makeOptions(),
    )
    expect(result.kind).toBe("valid")
  })

  test("#given parent=manager and target=manager #when validating #then blocked (dispatcher-to-dispatcher loop)", () => {
    const result = validateSubagentRequest(
      { subagent_type: "manager", prompt: "dispatch it", load_skills: [], run_in_background: false, description: "test" },
      "manager",
      "",
      makeOptions(),
    )
    expect(result.kind).toBe("invalid")
  })

  test("#given parent=planner and target=manager #when validating #then blocked (lead-to-dispatcher loop)", () => {
    const result = validateSubagentRequest(
      { subagent_type: "manager", prompt: "dispatch it", load_skills: [], run_in_background: false, description: "test" },
      "planner",
      "",
      makeOptions(),
    )
    expect(result.kind).toBe("invalid")
  })
})

module.exports = {}
