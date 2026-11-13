import type { OpenCodeEvent } from "@opencode/client"
import { mapV2TaskEvent } from "../native-task/v2-event-adapter"
import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNativeModelPolicyHealth } from "../native-catalog/model-policy-health"
import type { NativeTaskRuntime } from "../native-task/types"
import { createHarness } from "../native-task/engine.test-support"
import { createNativeTaskEngine } from "../native-task/engine"
import { createNativeModelPolicyObserver } from "./model-policy-observer"

const privacy = "Model trains on request data. Privacy settings prohibit this model."

test("native message identity survives an incremented retry attempt and restart without renewing quarantine", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-policy-observer-"))
  let time = 1000
  try {
    const h = createHarness()
    const task = await h.engine.create({ callerSessionID: "root", prompt: "work" })
    expect(task.model).toBeDefined()
    let inspection: Awaited<ReturnType<NativeTaskRuntime["inspect"]>> = { state: "failed", error: privacy, failureID: "native-message-1", failureModel: task.model, failureAt: 1000 }
    const runtime = { inspect: async () => inspection }
    const file = join(directory, "policy.json")
    const health = () => createNativeModelPolicyHealth(file, { now: () => time, ttlMs: 100 })
    await createNativeModelPolicyObserver(runtime, health())(task, privacy)
    expect((await health().get(task.model!))?.unavailableUntil).toBe(1100)
    time = 1101
    task.attempts += 1
    await createNativeModelPolicyObserver(runtime, health())(task, privacy)
    expect(await health().get(task.model!)).toBeUndefined()
    inspection = { ...inspection, failureID: "native-message-2", failureAt: 1101 }
    await createNativeModelPolicyObserver(runtime, health())(task, privacy)
    expect((await health().get(task.model!))?.unavailableUntil).toBe(1201)
    const replacement = { providerID: task.model!.providerID, id: "replacement-model" }
    task.model = replacement
    await createNativeModelPolicyObserver(runtime, health())(task, privacy)
    expect(await health().get(replacement)).toBeUndefined()
    inspection = { state: "failed", error: privacy, failureID: "missing-model" }
    await expect(createNativeModelPolicyObserver(runtime, health())(task, privacy)).rejects.toBeInstanceOf(Error)
    expect(await health().get(replacement)).toBeUndefined()
    inspection = { state: "failed", error: privacy, failureModel: replacement }
    await expect(createNativeModelPolicyObserver(runtime, health())(task, privacy)).rejects.toBeInstanceOf(Error)
    expect(await health().get(replacement)).toBeUndefined()
    inspection = { state: "succeeded", result: privacy }
    await createNativeModelPolicyObserver(runtime, health())(task, "ordinary native failure")
    expect(await health().get(replacement)).toBeUndefined()
  } finally { await rm(directory, { recursive: true, force: true }) }
})


test("accepted privacy failure waits for immutable evidence when native active bookkeeping still reports running", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-policy-event-lag-"))
  try {
    const h = createHarness()
    const health = createNativeModelPolicyHealth(join(directory, "health.json"), { now: () => 1000, ttlMs: 100 })
    let inspection: Awaited<ReturnType<NativeTaskRuntime["inspect"]>> = { state: "running" }
    h.runtime.inspect = async () => inspection
    const engine = createNativeTaskEngine({ repository: h.repository, runtime: h.runtime, router: h.router, maxConcurrent: 1,
      onExecutionFailure: createNativeModelPolicyObserver(h.runtime, health),
    })
    h.router.revalidateSelected = async (input) => await health.get({ providerID: "test", id: "model" }) ? { kind: "unavailable", reason: "policy" } : h.router.routeResult(input)
    const first = await engine.create({ callerSessionID: "root", prompt: "first" })
    const queued = await engine.create({ callerSessionID: "root", prompt: "second" })
    await engine.onEvent({ id: "privacy-event", type: "execution.failed", sessionID: first.sessionID!, error: privacy })
    expect((await h.repository.get(first.id))?.failureObservationError).toBeDefined()
    expect((await h.repository.get(queued.id))?.state).toBe("queued")
    expect(h.runtime.starts).toHaveLength(1)
    expect(await health.get(first.model!)).toBeUndefined()
    await engine.checkWatchdogs()
    expect((await h.repository.get(first.id))?.failureObservationError).toBeDefined()
    expect((await h.repository.get(queued.id))?.state).toBe("queued")
    inspection = { state: "failed", error: privacy, failureID: "actual-message", failureModel: first.model, failureAt: 1000 }
    await engine.checkWatchdogs()
    expect((await h.repository.get(first.id))?.failureObservationError).toBeUndefined()
    expect((await h.repository.get(queued.id))?.state).toBe("failed")
    expect(h.runtime.starts).toHaveLength(1)
    expect((await health.get(first.model!))?.failureID).toBe("actual-message")
  } finally { await rm(directory, { recursive: true, force: true }) }
})


test("non-privacy failures do not wait for policy inspection when native active state lags", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-policy-unrelated-"))
  try {
    const h = createHarness()
    const health = createNativeModelPolicyHealth(join(directory, "health.json"))
    let inspections = 0
    h.runtime.inspect = async () => { inspections++; return { state: "running" } }
    const engine = createNativeTaskEngine({ repository: h.repository, runtime: h.runtime, router: h.router, maxConcurrent: 1,
      onExecutionFailure: createNativeModelPolicyObserver(h.runtime, health),
    })
    const first = await engine.create({ callerSessionID: "root", prompt: "first" })
    const queued = await engine.create({ callerSessionID: "root", prompt: "second" })
    await engine.onEvent({ id: "ordinary-failure", type: "execution.failed", sessionID: first.sessionID!, error: "quota exceeded" })
    expect((await h.repository.get(first.id))?.failureObservationError).toBeUndefined()
    expect((await h.repository.get(queued.id))?.state).toBe("running")
    expect(inspections).toBe(1)
    expect(await health.list()).toHaveLength(0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test("typed quota hint waits for native identity, then excludes only the observed model without replay renewal", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-quota-observer-"))
  let time = 1000
  try {
    const h = createHarness()
    const task = await h.engine.create({ callerSessionID: "root", prompt: "work" })
    const quota = { type: "provider.free-limit" as const, status: 429 as const, retryAfterMs: 100 }
    const error = JSON.stringify(quota)
    let inspection: Awaited<ReturnType<NativeTaskRuntime["inspect"]>> = { state: "running" }
    const health = () => createNativeModelPolicyHealth(join(directory, "health.json"), { now: () => time })
    const observe = () => createNativeModelPolicyObserver({ inspect: async () => inspection }, health())(task, error)
    await expect(observe()).rejects.toBeInstanceOf(Error)
    inspection = { state: "failed", error, failureID: "native", failureAt: 1000, failureModel: task.model }
    await observe()
    expect(await health().list()).toHaveLength(0)
    inspection.failureQuota = quota
    await observe()
    expect(await health().get(task.model!)).toMatchObject({ unavailableUntil: 1100, reason: "observed_free_quota_limit" })
    time = 1101
    await observe()
    expect(await health().list()).toHaveLength(0)
    inspection.failureID = "unrelated-model"
    inspection.failureModel = { providerID: "go", id: "subscription" }
    await observe()
    expect(await health().list()).toHaveLength(0)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

test("native quota event holds queued dispatch until message evidence is available", async () => {
  const directory = await mkdtemp(join(tmpdir(), "native-quota-event-"))
  try {
    const h = createHarness()
    const quota = { type: "provider.free-limit", status: 429, retryAfterMs: 100, message: "Free usage limit reached" }
    const health = createNativeModelPolicyHealth(join(directory, "health.json"), { now: () => 1000 })
    let inspection: Awaited<ReturnType<NativeTaskRuntime["inspect"]>> = { state: "running" }
    h.runtime.inspect = async () => inspection
    const engine = createNativeTaskEngine({ repository: h.repository, runtime: h.runtime, router: h.router, maxConcurrent: 1,
      onExecutionFailure: createNativeModelPolicyObserver(h.runtime, health) })
    h.router.revalidateSelected = async input => await health.get({ providerID: "test", id: "model" }) ? { kind: "unavailable", reason: "quota" } : h.router.routeResult(input)
    const first = await engine.create({ callerSessionID: "root", prompt: "first" })
    const queued = await engine.create({ callerSessionID: "root", prompt: "second" })
    // Newer native error variants are intentionally unknown to the pinned client types.
    const native = { id: "quota-event", created: 1000, type: "session.execution.failed", durable: { aggregateID: first.sessionID, seq: 2, version: 1 }, data: { sessionID: first.sessionID, error: quota } } as unknown as OpenCodeEvent
    await engine.onEvent(mapV2TaskEvent(native)!)
    expect((await h.repository.get(first.id))?.failureObservationError).toBeDefined()
    expect((await h.repository.get(queued.id))?.state).toBe("queued")
    expect(h.runtime.starts).toHaveLength(1)
    inspection = { state: "failed", error: JSON.stringify(quota), failureID: "native-message", failureModel: first.model, failureAt: 1000, failureQuota: { type: "provider.free-limit", status: 429, retryAfterMs: 100 } }
    await engine.checkWatchdogs()
    expect((await h.repository.get(first.id))?.failureObservationError).toBeUndefined()
    expect((await h.repository.get(queued.id))?.state).toBe("failed")
    expect(h.runtime.starts).toHaveLength(1)
    expect((await health.get(first.model!))?.unavailableUntil).toBe(1100)
  } finally { await rm(directory, { recursive: true, force: true }) }
})
