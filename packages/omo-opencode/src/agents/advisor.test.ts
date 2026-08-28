import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { createBuiltinAgents } from "./builtin-agents"
import * as shared from "../shared"
import {
  clearSessionAdvisorBinding,
  getSessionAdvisorBinding,
  hasSessionAdvisorBinding,
  parseAdvisorCommandArgs,
  resolveAdvisorModel,
  setSessionAdvisorBinding,
} from "./advisor-binding"

const TEST_MODEL = "anthropic/claude-opus-5"
const SESSION = "sess_advisor_1"

describe("advisor command parsing", () => {
  test("no args reports", () => {
    expect(parseAdvisorCommandArgs(undefined)).toEqual({ action: "report" })
    expect(parseAdvisorCommandArgs("   ")).toEqual({ action: "report" })
  })

  test("off / unbind unbinds", () => {
    expect(parseAdvisorCommandArgs("off")).toEqual({ action: "unbind" })
    expect(parseAdvisorCommandArgs("unbind")).toEqual({ action: "unbind" })
  })

  test("a model id binds", () => {
    expect(parseAdvisorCommandArgs("neuralwatt/glm-5.2")).toEqual({
      action: "bind",
      model: "neuralwatt/glm-5.2",
    })
    expect(parseAdvisorCommandArgs("  openai/gpt-5.5  ")).toEqual({
      action: "bind",
      model: "openai/gpt-5.5",
    })
  })
})

describe("advisor binding resolution precedence", () => {
  test("session binding wins over config", () => {
    expect(resolveAdvisorModel({ configModel: "a/b", sessionModel: "c/d" })).toBe("c/d")
  })

  test("config used when no session binding", () => {
    expect(resolveAdvisorModel({ configModel: "a/b" })).toBe("a/b")
  })

  test("undefined when neither set", () => {
    expect(resolveAdvisorModel({})).toBeUndefined()
  })
})

describe("advisor session binding store", () => {
  afterEach(() => clearSessionAdvisorBinding(SESSION))

  test("set then get", () => {
    expect(hasSessionAdvisorBinding(SESSION)).toBe(false)
    setSessionAdvisorBinding(SESSION, "neuralwatt/glm-5.2")
    expect(hasSessionAdvisorBinding(SESSION)).toBe(true)
    expect(getSessionAdvisorBinding(SESSION)).toBe("neuralwatt/glm-5.2")
  })

  test("clear yields unbound", () => {
    setSessionAdvisorBinding(SESSION, "x/y")
    clearSessionAdvisorBinding(SESSION)
    expect(getSessionAdvisorBinding(SESSION)).toBeUndefined()
  })
})

describe("advisor agent registration", () => {
  function spies() {
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set([TEST_MODEL]))
    spyOn(shared, "readConnectedProvidersCache").mockReturnValue(null)
    spyOn(shared, "readProviderModelsCache").mockReturnValue(null)
    return fetchSpy
  }

  async function buildAgents(overrides: Record<string, unknown>) {
    return createBuiltinAgents(
      [],
      overrides,
      undefined,
      TEST_MODEL,
      undefined,
      undefined,
      [],
      undefined,
      undefined,
      undefined,
      undefined,
      false,
      false,
      false,
    )
  }

  test("registers unconditionally (unbound enforcement lives in the delegation gate)", async () => {
    const fetchSpy = spies()
    try {
      const agents = await buildAgents({})
      expect(agents.advisor).toBeDefined()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("config model override applies at registration", async () => {
    const fetchSpy = spies()
    try {
      const agents = await buildAgents({ advisor: { model: TEST_MODEL } })
      expect(agents.advisor.model).toBe(TEST_MODEL)
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
