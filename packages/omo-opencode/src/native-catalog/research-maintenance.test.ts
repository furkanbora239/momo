import { afterEach, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNativeResearchMaintenance } from "./research-maintenance"

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))) })
const model = { providerID: "fixture", id: "selected" }
const context = { decisionId: "origin", rootSessionID: "root", parentSessionID: "root", parentRole: "orchestrator" }
async function file() { const directory = await mkdtemp(join(tmpdir(), "maintenance-")); directories.push(directory); return join(directory, "queue.json") }
function options() {
  return { isEligible: async () => true, isBusy: async () => false, inspect: async () => "running", hasKnowledge: async () => false, create: async ({ taskID }: { taskID: string }) => ({ id: taskID, state: "running" }) }
}
test("unbound selected-only maintenance persists paused dedup across restart without spawning", async () => {
  const path = await file()
  let calls = 0
  const deps = { ...options(), create: async ({ taskID }: { taskID: string }) => { calls++; return { id: taskID, state: "running" } } }
  const first = createNativeResearchMaintenance(path, deps)
  await first.enqueue(model, context)
  await first.enqueue(model, context)
  await first.pump()
  const restarted = createNativeResearchMaintenance(path, deps)
  await restarted.enqueue(model, { ...context, decisionId: "new" })
  expect(await restarted.list()).toMatchObject([{ model, status: "paused", reason: "executor_unbound", context }])
  expect(calls).toBe(0)
})
test("binding launches one idle job and allows catalog snapshots during eligibility and create", async () => {
  const path = await file()
  let busy = true
  let known = false
  let state = "running"
  const calls: string[] = []
  const queue = createNativeResearchMaintenance(path, { ...options(), executor: model, isBusy: async () => busy, hasKnowledge: async () => known, inspect: async () => state,
    isEligible: async () => { await queue.list(); return true },
    create: async ({ taskID }) => { await queue.list(); calls.push(taskID); return { id: taskID, state } },
  })
  await queue.enqueue(model, context)
  await queue.enqueue({ ...model, id: "second" }, context)
  await queue.pump()
  expect(calls).toHaveLength(0)
  busy = false
  await Promise.all([queue.pump(), queue.pump()])
  expect(calls).toHaveLength(1)
  await queue.pump()
  expect(calls).toHaveLength(1)
  known = true; state = "succeeded"
  await queue.pump()
  expect((await queue.list())[0]?.status).toBe("completed")
})
test("restart resumes the same interrupted assignment without creating another job", async () => {
  const path = await file()
  let state = "running"
  const starts: string[] = []
  const resumes: string[] = []
  const deps = { ...options(), executor: model, inspect: async () => state,
    create: async ({ taskID }: { taskID: string }) => { starts.push(taskID); return { id: taskID, state } },
    resume: async (taskID: string) => { resumes.push(taskID); state = "running" },
  }
  const first = createNativeResearchMaintenance(path, deps)
  await first.enqueue(model, context); await first.pump()
  state = "interrupted"
  const restarted = createNativeResearchMaintenance(path, deps)
  await restarted.enqueue(model, context); await restarted.pump()
  expect(starts).toHaveLength(1)
  expect(resumes).toEqual(starts)
  expect((await restarted.list())[0]?.status).toBe("running")
})

test("model maintenance task identities remain distinct across project queues", async () => {
  const identities: string[] = []
  for (const path of [await file(), await file()]) {
    const queue = createNativeResearchMaintenance(path, { ...options(), executor: model, create: async ({ taskID }) => { identities.push(taskID); return { id: taskID, state: "running" } } })
    await queue.enqueue(model, context); await queue.pump()
  }
  expect(new Set(identities).size).toBe(2)
})
test("uncertain reserved launch pauses on restart without replay or starving another model", async () => {
  const path = await file()
  await writeFile(path, JSON.stringify({ version: 1, entries: [{ model, context, status: "running", reason: "launch_pending", taskID: "reserved", updatedAt: 1 }] }))
  const starts: string[] = []
  const queue = createNativeResearchMaintenance(path, { ...options(), executor: model, inspect: async () => undefined, create: async ({ taskID }) => { starts.push(taskID); return { id: taskID, state: "running" } } })
  await queue.enqueue({ ...model, id: "later" }, context)
  await queue.pump()
  expect(starts).toHaveLength(1)
  expect(starts[0]).not.toBe("reserved")
  expect((await queue.list())[0]).toMatchObject({ status: "paused", reason: "research_launch_uncertain", taskID: "reserved" })
})
