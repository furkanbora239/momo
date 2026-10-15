import { expect, test } from "bun:test"
import { createHarness } from "./engine.test-support"
import { createNativeTaskEngine } from "./engine"

async function department() {
  const h = createHarness()
  h.router.routeResult = () => ({ kind: "selected", decisionId: "dept", role: "planner", model: { providerID: "test", id: "dept" } })
  const parent = await h.engine.create({ prompt: "department", callerSessionID: "root" })
  h.router.routeResult = () => ({ kind: "selected", decisionId: "child", role: "worker", model: { providerID: "test", id: "worker" } })
  const first = await h.engine.create({ prompt: "first", callerSessionID: parent.sessionID! })
  const second = await h.engine.create({ prompt: "second", callerSessionID: parent.sessionID! })
  await h.engine.onEvent({ id: "waiting", type: "execution.succeeded", sessionID: parent.sessionID!, result: "initial" })
  h.runtime.deliver = async input => { h.runtime.deliveries.push({ taskID: input.taskID, result: input.result }); return { status: "admitted" } }
  return { ...h, parent, first, second }
}

test("one aggregate consumption marks all bound children after durable binding before native admission", async () => {
  const h = await department()
  h.runtime.continueParent = async input => {
    const parent = (await h.repository.get(h.parent.id))!
    const batch = parent.childrenBatch!
    expect(batch.childTaskIDs).toEqual([h.first.id, h.second.id])
    for (const child of [h.first, h.second]) expect((await h.repository.get(child.id))?.delivery).toMatchObject({ aggregateTaskID: h.parent.id, messageID: batch.messageID, status: "admitted", receiptVersion: 2 })
    expect(input.message).toContain(h.first.id)
    expect(input.message).toContain(h.second.id)
    // Real events wait for the parent lock; test emits after SDK admission below.
    h.runtime.parentContinuations.push(input.message)
    return { status: "admitted" }
  }
  await h.engine.cancel(h.first.id, "root"); await h.engine.cancel(h.second.id, "root")
  const batch = (await h.repository.get(h.parent.id))!.childrenBatch!
  await h.engine.onEvent({ id: "batch-consumed", type: "delivery.consumed", sessionID: h.parent.sessionID!, inboxID: batch.messageID })
  for (const child of [h.first, h.second]) expect((await h.repository.get(child.id))?.delivery?.status).toBe("delivered")
  expect((await h.repository.get(h.parent.id))?.childrenBatch?.status).toBe("delivered")
  expect(h.runtime.parentContinuations).toHaveLength(1)
})

test("restart after retraction before aggregate admission retries one stable batch without individual child replay", async () => {
  const h = await department()
  let failure = true
  const identities: string[] = []
  h.runtime.continueParent = async input => {
    identities.push(h.runtime.childrenWakeMessageID(input.taskID, input.wakeID!))
    if (failure) { failure = false; throw new Error("503 after individual retractions") }
    h.runtime.parentContinuations.push(input.message)
    return { status: "admitted" }
  }
  await h.engine.cancel(h.first.id, "root"); await h.engine.cancel(h.second.id, "root")
  expect((await h.repository.get(h.parent.id))?.state).toBe("waiting_children")
  const originalResults = [await h.repository.get(h.first.id), await h.repository.get(h.second.id)].map(task => task?.result)
  h.runtime.inspectDelivery = async () => "missing"
  const restarted = createNativeTaskEngine({ repository: h.repository, router: h.router, runtime: h.runtime })
  await restarted.reconcile()
  expect(identities).toHaveLength(2)
  expect(new Set(identities).size).toBe(1)
  expect(h.runtime.deliveries).toHaveLength(2)
  expect(h.runtime.starts).toHaveLength(3)
  expect([await h.repository.get(h.first.id), await h.repository.get(h.second.id)].map(task => task?.result)).toEqual(originalResults)
  expect((await h.repository.get(h.parent.id))?.childrenBatch?.message).toContain(originalResults[0]!)
  expect((await h.repository.get(h.parent.id))?.childrenBatch?.message).toContain(originalResults[1]!)
})

test("cancelled departments never reactivate a pending aggregate", async () => {
  const h = await department()
  h.runtime.continueParent = async () => { throw new Error("pending") }
  await h.engine.cancel(h.first.id, "root"); await h.engine.cancel(h.second.id, "root")
  await h.engine.cancel(h.parent.id, "root")
  h.runtime.inspectDelivery = async () => "missing"
  await h.engine.retryDeliveries()
  expect((await h.repository.get(h.parent.id))?.state).toBe("cancelled")
  expect(h.runtime.parentContinuations).toHaveLength(0)
})

test("native consumption before a lost SDK receipt recovers final parent outcome without another generation", async () => {
  const h = await department()
  let admissions = 0
  h.runtime.continueParent = async () => { admissions++; throw new Error("SDK response lost after native consumption") }
  await h.engine.cancel(h.first.id, "root"); await h.engine.cancel(h.second.id, "root")
  expect((await h.repository.get(h.parent.id))?.childrenBatch?.status).toBe("pending")
  h.runtime.inspectDelivery = async () => "delivered"
  h.runtime.inspect = async () => ({ state: "succeeded", result: "actual native aggregate outcome" })
  const restarted = createNativeTaskEngine({ repository: h.repository, router: h.router, runtime: h.runtime })
  await restarted.reconcile()
  expect(admissions).toBe(1)
  expect(await h.repository.get(h.parent.id)).toMatchObject({ state: "succeeded", result: "actual native aggregate outcome", childrenWakePending: false, childrenBatch: { status: "delivered" } })
  for (const child of [h.first, h.second]) expect((await h.repository.get(child.id))?.delivery?.status).toBe("delivered")
  expect(h.runtime.starts).toHaveLength(3)
  expect(h.runtime.resumes).toHaveLength(0)
})
