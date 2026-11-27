import { expect, test } from "bun:test"
import { readNativeToolCapabilities } from "./tool-capabilities"

test("worker discovers disabled consultation separately from questions and delegation", async () => {
  const result = await readNativeToolCapabilities({ agent: "momo-worker", managed: true, advisors: [], available: [], isAllowed: async () => true })
  expect(result.consultation).toMatchObject({ allowed: true, enabled: false, reason: "advisor_pool_empty" })
  expect(result.delegation.allowed).toBe(false)
  expect(result.questions).toMatchObject({ supported: true, destination: "parent", tool: "momo_ask_parent" })
})

test("consult availability intersects configured advisors, current availability and hard pool", async () => {
  const models = ["ready", "disabled", "denied", "missing", "no-tools"].map(id => ({ providerID: "provider", id }))
  const result = await readNativeToolCapabilities({ agent: "momo-orchestrator", managed: false, advisors: [...models, models[0]!], available: models.filter(model => model.id !== "missing").map(model => ({ ...model, available: model.id !== "disabled", toolCall: model.id !== "no-tools" })), isAllowed: async model => model.id !== "denied" })
  expect(result.consultation).toMatchObject({ enabled: true, eligibleCount: 1, configuredCount: 5, models: [models[0]!] })
  expect(result.questions.destination).toBe("user")
})

test("advisor cannot discover consultation as executable and headless research cannot ask", async () => {
  const options = { managed: true, advisors: [{ providerID: "p", id: "m" }], available: [{ providerID: "p", id: "m", available: true }], isAllowed: async () => true }
  expect((await readNativeToolCapabilities({ ...options, agent: "momo-advisor" })).consultation).toMatchObject({ enabled: false, reason: "role_denied", models: [] })
  expect((await readNativeToolCapabilities({ ...options, agent: "momo-catalog-researcher" })).questions.supported).toBe(false)
})

test("consultation is unavailable when only the session model is configured", async () => {
  const callerModel = { providerID: "p", id: "caller" }
  const result = await readNativeToolCapabilities({ agent: "momo-orchestrator", advisors: [callerModel], callerModel, available: [{ ...callerModel, available: true }], isAllowed: () => true })
  expect(result.consultation).toMatchObject({ enabled: false, reason: "no_distinct_advisor", configuredCount: 1, eligibleCount: 0, models: [] })
})
