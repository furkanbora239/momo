import { afterEach, describe, expect, test } from "bun:test"
import { createAdvisorTool } from "./tools"
import { clearSessionAdvisorBinding, getSessionAdvisorBinding } from "../../agents/advisor-binding"

const SESSION = "sess_advisor_tool_test"

function run(tool: ReturnType<typeof createAdvisorTool>, args: { action?: "bind" | "off" | "report"; model?: string }) {
  return tool.execute(args, { sessionID: SESSION } as never)
}

describe("advisor tool", () => {
  afterEach(() => clearSessionAdvisorBinding(SESSION))

  test("given no binding #when reported #then it says unbound and how to bind", async () => {
    const result = await run(createAdvisorTool(), {})
    expect(result).toContain("UNBOUND")
    expect(result).toContain("agents.advisor.model")
  })

  test("given a bind action #when executed #then the session binding is set and reported", async () => {
    const advisor = createAdvisorTool()
    const bindResult = await run(advisor, { action: "bind", model: "neuralwatt/glm-5.2" })
    expect(bindResult).toContain("neuralwatt/glm-5.2")
    expect(getSessionAdvisorBinding(SESSION)).toBe("neuralwatt/glm-5.2")

    const reportResult = await run(advisor, { action: "report" })
    expect(reportResult).toContain("neuralwatt/glm-5.2")
    expect(reportResult).toContain("session")
  })

  test("given bind without a model #when executed #then it is rejected without mutating state", async () => {
    const result = await run(createAdvisorTool(), { action: "bind" })
    expect(result).toContain("requires")
    expect(getSessionAdvisorBinding(SESSION)).toBeUndefined()
  })

  test("given a session binding #when off #then the binding is cleared", async () => {
    const advisor = createAdvisorTool()
    await run(advisor, { action: "bind", model: "neuralwatt/glm-5.2" })
    const result = await run(advisor, { action: "off" })
    expect(result).toContain("UNBOUND")
    expect(getSessionAdvisorBinding(SESSION)).toBeUndefined()
  })

  test("given a config binding #when off clears the session binding #then the config binding still applies", async () => {
    const advisor = createAdvisorTool({ configModel: "google/gemini-3.1-pro" })
    await run(advisor, { action: "bind", model: "neuralwatt/glm-5.2" })
    const offResult = await run(advisor, { action: "off" })
    expect(offResult).toContain("google/gemini-3.1-pro")

    const reportResult = await run(advisor, { action: "report" })
    expect(reportResult).toContain("google/gemini-3.1-pro")
    expect(reportResult).toContain("config")
  })

  test("given a model but no action #when executed #then it binds", async () => {
    const result = await run(createAdvisorTool(), { model: "neuralwatt/glm-5.2" })
    expect(result).toContain("bound")
    expect(getSessionAdvisorBinding(SESSION)).toBe("neuralwatt/glm-5.2")
  })
})
