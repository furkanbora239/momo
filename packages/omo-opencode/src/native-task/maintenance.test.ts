import { expect, test } from "bun:test"
import { createNativeTaskEngine } from "./engine"
import { createHarness } from "./engine.test-support"
const executor = { providerID: "test", id: "bound" }
test("maintenance requires a binding and never invokes ordinary routing", async () => {
  const h = createHarness()
  await expect(h.engine.createResearch({ prompt: "research", callerSessionID: "root", sourceDecisionID: "origin" })).rejects.toThrow("explicit executor")
  const task = await h.engine.createResearch({ prompt: "research", callerSessionID: "root", sourceDecisionID: "origin", executor })
  expect(task.state).toBe("failed")
  expect(h.router.routeInputs).toHaveLength(0)
})
test("bound maintenance does not notify root on completion or questions", async () => {
  const h = createHarness()
  h.router.bindResearch = async (input, model) => ({ kind: "selected", decisionId: input.decisionId!, role: "catalog-researcher", model })
  const task = await h.engine.createResearch({ prompt: "research", callerSessionID: "root", sourceDecisionID: "origin", executor })
  await h.engine.onEvent({ id: "question", type: "question.asked", sessionID: task.sessionID!, question: { id: "q", prompt: "choose" } })
  expect(await h.repository.get(task.id)).toMatchObject({ state: "failed", maintenance: true })
  expect(h.runtime.questions).toHaveLength(0)
  expect(h.runtime.escalations).toHaveLength(0)
  expect(h.runtime.deliveries).toHaveLength(0)
  expect((await h.repository.get(task.id))?.delivery).toBeUndefined()
  const completed = await h.engine.createResearch({ prompt: "research", callerSessionID: "root", sourceDecisionID: "second", executor })
  await h.engine.onEvent({ id: "completed", type: "execution.succeeded", sessionID: completed.sessionID!, result: "enriched" })
  expect((await h.repository.get(completed.id))?.delivery).toBeUndefined()
  expect(h.runtime.deliveries).toHaveLength(0)
})

test("accepted native failures are observed before the next dispatch, stale and duplicate failures are ignored", async () => {
  const h = createHarness()
  const observed: string[] = []
  let blocked = false
  const engine = createNativeTaskEngine({ repository: h.repository, runtime: h.runtime, router: h.router, maxConcurrent: 1,
    onExecutionFailure: async (task, error) => { observed.push(task.id + ":" + error); blocked = true },
  })
  h.router.revalidateSelected = async (input) => blocked ? { kind: "unavailable", reason: "quarantined" } : h.router.routeResult(input)
  const task = await engine.create({ prompt: "first", callerSessionID: "root" })
  await engine.onEvent({ id: "started", type: "execution.started", sessionID: task.sessionID!, sequence: 10 })
  const queued = await engine.create({ prompt: "second", callerSessionID: "root" })
  await engine.onEvent({ id: "old", type: "execution.failed", sessionID: task.sessionID!, sequence: 9, error: "stale" })
  expect(observed).toEqual([])
  const failure = { id: "actual", type: "execution.failed" as const, sessionID: task.sessionID!, sequence: 11, error: "native failure" }
  await engine.onEvent(failure); await engine.onEvent(failure)
  expect(observed).toEqual([task.id + ":native failure"])
  expect((await h.repository.get(queued.id))?.state).toBe("failed")
  expect(h.runtime.starts).toHaveLength(1)
})

test("restart observes inspected native failures before dispatch even after the task failure was saved", async () => {
  const h = createHarness()
  const original = createNativeTaskEngine({ repository: h.repository, runtime: h.runtime, router: h.router, maxConcurrent: 1 })
  const first = await original.create({ prompt: "first", callerSessionID: "root" })
  const second = await original.create({ prompt: "second", callerSessionID: "root" })
  let blocked = false
  h.runtime.inspect = async (sessionID) => sessionID === first.sessionID ? { state: "failed", error: "native privacy rejection" } : { state: "running" }
  h.router.revalidateSelected = async (input) => blocked ? { kind: "unavailable", reason: "quarantined" } : h.router.routeResult(input)
  const restart = createNativeTaskEngine({ repository: h.repository, runtime: h.runtime, router: h.router, maxConcurrent: 1,
    onExecutionFailure: async (_task, error) => { expect(error).toBe("native privacy rejection"); blocked = true },
  })
  await restart.reconcile()
  expect(blocked).toBe(true)
  expect(h.runtime.starts).toHaveLength(1)
  blocked = false
  await restart.reconcile()
  expect(blocked).toBe(true)
  expect((await h.repository.get(second.id))?.state).toBe("failed")
})


test("restart keeps maintenance interrupted for the idle queue and rechecks active root before dispatch", async () => {
  const h = createHarness()
  h.router.bindResearch = async (input, model) => ({ kind: "selected", decisionId: input.decisionId!, role: "catalog-researcher", model })
  const task = await h.engine.createResearch({ prompt: "research", callerSessionID: "root", sourceDecisionID: "origin", executor })
  await h.repository.save({ ...task, state: "interrupted" })
  let rootBusy = true
  const restarted = createNativeTaskEngine({ repository: h.repository, runtime: h.runtime, router: h.router,
    canRunMaintenance: async () => !rootBusy,
  })
  await restarted.reconcile()
  expect((await h.repository.get(task.id))?.state).toBe("interrupted")
  expect(h.runtime.resumes).toHaveLength(0)
  await restarted.resume(task.id, "root")
  expect((await h.repository.get(task.id))?.state).toBe("queued")
  expect(h.runtime.resumes).toHaveLength(0)
  rootBusy = false
  await restarted.reconcile()
  expect((await h.repository.get(task.id))?.state).toBe("running")
  expect(h.runtime.resumes).toHaveLength(1)
})


test("pending foreground caller selection blocks maintenance until selection is resolved", async () => {
  const h = createHarness()
  const foreground = await h.engine.create({ prompt: "foreground", callerSessionID: "root" })
  await h.repository.save({ ...foreground, state: "awaiting_selection" })
  h.router.bindResearch = async (input, model) => ({ kind: "selected", decisionId: input.decisionId!, role: "catalog-researcher", model })
  const maintenance = await h.engine.createResearch({ prompt: "research", callerSessionID: "root", sourceDecisionID: "origin", executor })
  expect(maintenance.state).toBe("queued")
  expect(h.runtime.starts).toHaveLength(1)
  await h.repository.save({ ...foreground, state: "cancelled" })
  await h.engine.reconcile()
  expect((await h.repository.get(maintenance.id))?.state).toBe("running")
  expect(h.runtime.starts).toHaveLength(2)
})

test("a transient failed-session inspection persists separately and allows other models to recover", async () => {
  const h = createHarness()
  const first = await h.engine.create({ prompt: "failed", callerSessionID: "root" })
  await h.repository.save({ ...first, state: "failed", error: "original native rejection" })
  const same = { ...first, id: "same-model", sessionID: undefined, state: "queued" as const }
  const other = { ...first, id: "other-model", sessionID: undefined, model: { providerID: "test", id: "other" }, state: "queued" as const }
  await h.repository.save(same)
  await h.repository.save(other)
  let unavailable = true
  h.runtime.inspect = async (sessionID) => {
    if (sessionID === first.sessionID && unavailable) throw new Error("native service 503")
    return sessionID === first.sessionID ? { state: "failed", error: "original native rejection" } : { state: "running" }
  }
  const observed: string[] = []
  const restarted = createNativeTaskEngine({ repository: h.repository, runtime: h.runtime, router: h.router,
    onExecutionFailure: async (task) => { observed.push(task.id) },
  })
  await restarted.reconcile()
  expect(await h.repository.get(first.id)).toMatchObject({ error: "original native rejection", failureObservationError: "native service 503" })
  expect((await h.repository.get(same.id))?.state).toBe("queued")
  expect((await h.repository.get(other.id))?.state).toBe("running")
  expect(observed).toHaveLength(0)
  unavailable = false
  await restarted.checkWatchdogs()
  expect((await h.repository.get(first.id))?.failureObservationError).toBeUndefined()
  expect((await h.repository.get(same.id))?.state).toBe("running")
  expect(observed).toEqual([first.id])
})


test("a failed live policy observation pauses that exact model until the watchdog can observe it", async () => {
  const h = createHarness()
  let unavailable = true
  const engine = createNativeTaskEngine({ repository: h.repository, runtime: h.runtime, router: h.router, maxConcurrent: 1,
    onExecutionFailure: async () => { if (unavailable) throw new Error("observation unavailable") },
  })
  const first = await engine.create({ callerSessionID: "root", prompt: "first" })
  const queued = await engine.create({ callerSessionID: "root", prompt: "second" })
  h.runtime.inspect = async (sessionID) => sessionID === first.sessionID ? { state: "failed", error: "native error" } : { state: "running" }
  await engine.onEvent({ id: "failure", type: "execution.failed", sessionID: first.sessionID!, error: "native error" })
  expect(await h.repository.get(first.id)).toMatchObject({ error: "native error", failureObservationError: "observation unavailable" })
  expect((await h.repository.get(queued.id))?.state).toBe("queued")
  unavailable = false
  await engine.checkWatchdogs()
  expect((await h.repository.get(first.id))?.failureObservationError).toBeUndefined()
  expect((await h.repository.get(queued.id))?.state).toBe("running")
})

test("a concurrent queue pump cannot dispatch the failed model while observation is pending", async () => {
  const h = createHarness()
  let release!: () => void
  let entered!: () => void
  const observing = new Promise<void>((resolve) => { entered = resolve })
  const observation = new Promise<void>((resolve) => { release = resolve })
  const engine = createNativeTaskEngine({ repository: h.repository, runtime: h.runtime, router: h.router, maxConcurrent: 1,
    onExecutionFailure: async () => { entered(); await observation },
  })
  const first = await engine.create({ callerSessionID: "root", prompt: "first" })
  const second = await engine.create({ callerSessionID: "root", prompt: "second" })
  const failure = engine.onEvent({ id: "failure", type: "execution.failed", sessionID: first.sessionID!, error: "Model trains on request data. Privacy settings prohibit this model." })
  await observing
  try {
    await engine.create({ callerSessionID: "root", prompt: "third" })
    expect((await h.repository.get(second.id))?.state).toBe("queued")
    expect(h.runtime.starts).toHaveLength(1)
  } finally { release(); await failure }
})
