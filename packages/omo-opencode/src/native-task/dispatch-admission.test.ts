import { expect, test } from "bun:test"
import { createNativeTaskEngine } from "./engine"
import { createHarness } from "./engine.test-support"

test("an unrelated pump cannot reserve an unassigned task while its route is pending", async () => {
  const h = createHarness()
  const selected = { kind: "selected" as const, decisionId: "decision", role: "worker" as const, model: { providerID: "test", id: "model" } }
  let entered!: () => void
  let release!: () => void
  const routing = new Promise<void>(resolve => { entered = resolve })
  const hold = new Promise<void>(resolve => { release = resolve })
  h.router.routeResult = async input => { if (input.prompt === "second") { entered(); await hold }; return selected }
  const engine = createNativeTaskEngine({ repository: h.repository, runtime: h.runtime, router: h.router, modelConcurrency: { "test/model": 1 } })
  const first = await engine.create({ callerSessionID: "root", prompt: "first" })
  const creating = engine.create({ callerSessionID: "root", prompt: "second" })
  await routing
  const pumping = engine.onEvent({ id: "progress", type: "progress", sessionID: first.sessionID!, message: "working" })
  await Bun.sleep(10)
  release()
  const [second] = await Promise.all([creating, pumping])
  expect(second.state).toBe("queued")
  expect(second.sessionID).toBeUndefined()
  expect(h.runtime.starts).toHaveLength(1)
})

test.each(["root", "foreground"] as const)("maintenance rechecks %s activity after awaited model revalidation", async source => {
  const h = createHarness()
  let busy = false
  let entered!: () => void
  let release!: () => void
  const validating = new Promise<void>(resolve => { entered = resolve })
  const hold = new Promise<void>(resolve => { release = resolve })
  const selected = { kind: "selected" as const, decisionId: "maintenance", role: "catalog-researcher" as const, model: { providerID: "test", id: "bound" } }
  h.router.bindResearch = async () => selected
  h.router.revalidateSelected = async () => { entered(); await hold; return selected }
  const engine = createNativeTaskEngine({ repository: h.repository, runtime: h.runtime, router: h.router, canRunMaintenance: async () => source !== "root" || !busy })
  const creating = engine.createResearch({ callerSessionID: "root", prompt: "maintenance", sourceDecisionID: "source", executor: selected.model })
  await validating
  busy = true
  if (source === "foreground") {
    const maintenance = (await h.repository.list())[0]!
    await h.repository.save({ ...maintenance, id: "foreground", maintenance: undefined, state: "awaiting_selection" })
  }
  release()
  const task = await creating
  expect(task.state).toBe("queued")
  expect(task.sessionID).toBeUndefined()
  expect(h.runtime.starts).toHaveLength(0)
})
