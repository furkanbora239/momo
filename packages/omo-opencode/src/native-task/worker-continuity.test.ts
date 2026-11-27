import { expect, test } from "bun:test"
import { createNativeTaskEngine } from "./engine"
import { FakeNativeTaskRouter, FakeNativeTaskRuntime, MemoryNativeTaskRepository } from "./testing"
import type { NativeTaskEvent, NativeTaskRouter, NativeTaskRuntime } from "./types"

const firstModel = { providerID: "provider-a", id: "initial" }
const secondModel = { providerID: "provider-b", id: "replacement" }
const rejection = JSON.stringify({ type: "provider.quota", status: 402 })
const receipt = {
  state: "failed", rejectedBeforeWork: true,
  failureID: "native-message-a", failureModel: firstModel, failureAt: 10_000,
  failureRejection: { kind: "payment_required", scope: "provider", retryAfterMs: 300_000 },
} as const

function setup() {
  const repository = new MemoryNativeTaskRepository()
  const router = new FakeNativeTaskRouter()
  router.routeResult = () => ({ kind: "selected", decisionId: "decision-a", model: firstModel, role: "worker" })
  const calls: string[] = []
  const outcomes: Record<string, string> = {}
  const routed: Parameters<NonNullable<NativeTaskRouter["selectWorkerReplacement"]>>[0][] = []
  const runtime = new FakeNativeTaskRuntime()
  let inspection: Awaited<ReturnType<NativeTaskRuntime["inspect"]>> = receipt
  let now = 10_000
  const options = {
    repository,
    router: Object.assign(router, {
      selectWorkerReplacement: async (input: typeof routed[number]) => {
        routed.push(input)
        return { kind: "selected", decisionId: "decision-b", model: secondModel, role: "worker" } as const
      },
      recordOutcome: async (id: string, outcome: { result: string }) => { outcomes[id] = outcome.result },
    }),
    runtime: Object.assign(runtime, {
      createSession: async ({ replacement }: Parameters<NativeTaskRuntime["createSession"]>[0]) => ({ sessionID: replacement ? "session-b" : "session-a" }),
      start: async ({ sessionID }: Parameters<NativeTaskRuntime["start"]>[0]) => { calls.push(sessionID) },
      inspect: async (sessionID?: string) => sessionID === "session-a" ? inspection : { state: "idle" as const },
    }),
    now: () => now,
  }
  return {
    engine: createNativeTaskEngine(options), options, repository, runtime, calls, routed, outcomes,
    inspectWith(value: typeof inspection) { inspection = value },
    advanceClock(ms: number) { now += ms },
  }
}

const failedEvent: NativeTaskEvent = { type: "execution.failed", sessionID: "session-a", id: "reject-a", sequence: 7, error: rejection }

test("recovery switches one durable task to a new worker session and drops late old-session events", async () => {
  const h = setup()
  const assigned = await h.engine.create({ callerSessionID: "root", prompt: "Read the fixture" })
  h.inspectWith({ state: "running" })
  await h.engine.onEvent(failedEvent)
  expect((await h.repository.get(assigned.id))?.pendingWorkerFailure).toBeDefined()
  expect(h.runtime.deliveries).toHaveLength(0)

  h.inspectWith(receipt)
  const restarted = createNativeTaskEngine(h.options)
  await restarted.reconcile()
  await restarted.onEvent({ type: "execution.succeeded", sessionID: "session-a", id: "late-a", sequence: 8, result: "stale" })
  await restarted.onEvent({ type: "execution.succeeded", sessionID: "session-b", id: "success-b", sequence: 1, result: "fixture" })
  await restarted.reconcile()

  expect(h.calls).toEqual(["session-a", "session-b"])
  expect(await h.repository.list()).toHaveLength(1)
  expect(await h.repository.get(assigned.id)).toMatchObject({
    state: "succeeded", attempts: 2, model: secondModel, sessionID: "session-b", result: "fixture",
    failedWorkerAttempt: { model: firstModel, sessionID: "session-a", reason: "payment_required", decisionId: "decision-a" },
  })
  expect(h.routed).toEqual([{ decisionId: "decision-a", sessionID: "session-a", excludeProvider: true, taskID: assigned.id, callerSessionID: "root" }])
  expect(h.outcomes).toEqual({ "decision-a": "failure", "decision-b": "success" })
  expect(h.runtime.deliveries).toEqual([{ taskID: assigned.id, result: "fixture" }])
})

test("a completed tool prevents replay even if session inspection reports no work", async () => {
  const h = setup()
  const task = await h.engine.create({ callerSessionID: "root", prompt: "Edit the fixture" })
  await h.engine.onEvent({ type: "tool.started", sessionID: "session-a", id: "tool", toolID: "edit-1", toolName: "edit" })
  await h.engine.onEvent({ type: "tool.finished", sessionID: "session-a", id: "tool-end", toolID: "edit-1" })
  await h.engine.onEvent(failedEvent)

  expect(await h.repository.get(task.id)).toMatchObject({ state: "failed", attempts: 1, error: expect.stringContaining("may have started work") })
  expect(h.calls).toEqual(["session-a"])
  expect(h.routed).toHaveLength(0)
})

test("an ambiguous launch fails with inspection guidance and never reruns on restart", async () => {
  const h = setup()
  const task = await h.engine.create({ callerSessionID: "root", prompt: "Read the fixture" })
  await h.engine.onEvent(failedEvent)
  expect(h.calls).toEqual(["session-a", "session-b"])

  const restarted = createNativeTaskEngine(h.options)
  await restarted.reconcile()
  expect(await h.repository.get(task.id)).toMatchObject({ state: "failed", attempts: 2, error: expect.stringContaining("launch could not be confirmed") })
  expect(h.calls).toEqual(["session-a", "session-b"])
  expect(h.runtime.resumes).toHaveLength(0)
})

test("missing terminal evidence expires without a second execution", async () => {
  const h = setup()
  const task = await h.engine.create({ callerSessionID: "root", prompt: "Read the fixture" })
  h.inspectWith({ state: "idle" })
  await h.engine.onEvent(failedEvent)
  h.advanceClock(90_000)
  await h.engine.checkWatchdogs()

  expect(await h.repository.get(task.id)).toMatchObject({ state: "failed", attempts: 1, error: expect.stringContaining("could not confirm") })
  expect(h.calls).toEqual(["session-a"])
  expect(h.runtime.deliveries).toHaveLength(1)
})
