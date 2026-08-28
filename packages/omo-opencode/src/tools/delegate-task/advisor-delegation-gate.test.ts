import { afterEach, describe, expect, test } from "bun:test"
import { resolveAdvisorDelegationGate } from "./advisor-delegation-gate"
import { clearSessionAdvisorBinding, setSessionAdvisorBinding } from "../../agents/advisor-binding"

const SESSION = "sess_advisor_gate_test"

describe("advisor delegation gate", () => {
  afterEach(() => clearSessionAdvisorBinding(SESSION))

  test("given a non-advisor agent #when gate resolves #then it is not intercepted", () => {
    expect(resolveAdvisorDelegationGate("explore", undefined, SESSION).kind).toBe("not-advisor")
    expect(resolveAdvisorDelegationGate("Sisyphus - ultraworker", undefined, SESSION).kind).toBe("not-advisor")
  })

  test("given no binding at all #when advisor delegation is gated #then it is rejected with binding instructions", () => {
    const result = resolveAdvisorDelegationGate("advisor", undefined, SESSION)
    expect(result.kind).toBe("unbound")
    if (result.kind !== "unbound") return
    expect(result.error).toContain("UNBOUND")
    expect(result.error).toContain("/advisor")
    expect(result.error).toContain("agents.advisor.model")
  })

  test("given a session binding #when advisor delegation is gated #then it passes with the session model", () => {
    setSessionAdvisorBinding(SESSION, "neuralwatt/glm-5.2")
    const result = resolveAdvisorDelegationGate("advisor", undefined, SESSION)
    expect(result.kind).toBe("bound")
    if (result.kind !== "bound") return
    expect(result.sessionModel).toBe("neuralwatt/glm-5.2")
  })

  test("given only a config binding #when advisor delegation is gated #then it passes without a session override", () => {
    const result = resolveAdvisorDelegationGate("advisor", { advisor: { model: "google/gemini-3.1-pro" } } as never, SESSION)
    expect(result.kind).toBe("bound")
    if (result.kind !== "bound") return
    expect(result.sessionModel).toBeUndefined()
  })

  test("given both bindings #when advisor delegation is gated #then the session binding wins", () => {
    setSessionAdvisorBinding(SESSION, "neuralwatt/glm-5.2")
    const result = resolveAdvisorDelegationGate("advisor", { advisor: { model: "google/gemini-3.1-pro" } } as never, SESSION)
    expect(result.kind).toBe("bound")
    if (result.kind !== "bound") return
    expect(result.sessionModel).toBe("neuralwatt/glm-5.2")
  })

  test("given no session id #when only a session binding could apply #then the gate stays unbound", () => {
    const result = resolveAdvisorDelegationGate("advisor", undefined, undefined)
    expect(result.kind).toBe("unbound")
  })
})
