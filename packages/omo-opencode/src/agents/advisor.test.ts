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

describe("advisor agent session binding", () => {
  function spies() {
    const fetchSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(new Set([TEST_MODEL]))
    spyOn(shared, "readConnectedProvidersCache").mockReturnValue(null)
    spyOn(shared, "readProviderModelsCache").mockReturnValue(null)
    return fetchSpy
  }

  async function buildAgents(overrides: Record<string, unknown>, sessionId?: string) {
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
      sessionId,
    )
  }

  afterEach(() => {
    clearSessionAdvisorBinding(SESSION)
  })

  test("session binding binds advisor even without config", async () => {
    const fetchSpy = spies()
    setSessionAdvisorBinding(SESSION, "neuralwatt/glm-5.2")
    try {
      const agents = await buildAgents({}, SESSION)
      expect(agents.advisor).toBeDefined()
      expect(agents.advisor.model).toBe("neuralwatt/glm-5.2")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("session binding takes precedence over config model", async () => {
    const fetchSpy = spies()
    setSessionAdvisorBinding(SESSION, "neuralwatt/glm-5.2")
    const overrides = { advisor: { model: TEST_MODEL } }
    try {
      const agents = await buildAgents(overrides, SESSION)
      expect(agents.advisor.model).toBe("neuralwatt/glm-5.2")
    } finally {
      fetchSpy.mockRestore()
    }
  })

  test("unset session + no config stays unbound", async () => {
    const fetchSpy = spies()
    try {
      const agents = await buildAgents({}, SESSION)
      expect(agents.advisor).toBeUndefined()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
