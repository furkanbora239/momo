import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNativeModelPolicyHealth } from "./model-policy-health"
import { parseNativeQuotaFailure } from "./model-quota-evidence"

test("accepts only typed native free-limit evidence with bounded positive retry duration", () => {
  const quota = { type: "provider.free-limit", status: 429, retryAfterMs: 37_243_000 }
  expect(parseNativeQuotaFailure(quota)).toEqual(quota)
  for (const value of ["Free usage limit reached", { ...quota, type: "api" }, { ...quota, status: 500 }, ...[0, -1, NaN, Infinity, "1000"].map(retryAfterMs => ({ ...quota, retryAfterMs }))]) {
    expect(parseNativeQuotaFailure(value)).toBeUndefined()
  }
  expect(parseNativeQuotaFailure({ ...quota, retryAfterMs: Number.MAX_VALUE })?.retryAfterMs).toBe(86_400_000)
})

test("quota expiry is bound to native completion and persists without replay renewal or provider-wide exclusion", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-quota-"))
  let time = 1000
  const model = { providerID: "free", id: "beam" }
  const file = join(root, "health.json")
  const health = () => createNativeModelPolicyHealth(file, { now: () => time })
  const failure = { message: "Free usage limit reached", taskID: "task", sessionID: "session", failureID: "native-message", occurredAt: 1000, quota: { type: "provider.free-limit" as const, status: 429 as const, retryAfterMs: 100 } }
  try {
    expect(await health().observe(model, failure)).toBe(true)
    expect(await health().get(model)).toMatchObject({ reason: "observed_free_quota_limit", observedAt: 1000, unavailableUntil: 1100, quota: failure.quota })
    expect(await health().get({ providerID: "free", id: "nemotron" })).toBeUndefined()
    expect(await health().get({ providerID: "go", id: "beam" })).toBeUndefined()
    time = 1001
    await health().observe(model, { ...failure, failureID: "shorter", occurredAt: 1001, quota: { ...failure.quota, retryAfterMs: 1 } })
    expect((await health().get(model))?.unavailableUntil).toBe(1100)
    time = 1101
    await health().observe(model, failure)
    expect(await health().get(model)).toBeUndefined()
    await health().observe(model, { ...failure, failureID: "delayed" })
    expect(await health().get(model)).toBeUndefined()
    for (const occurredAt of [undefined, NaN, Infinity, -1, 0, time + 1]) {
      expect(await health().observe(model, { ...failure, failureID: String(occurredAt), occurredAt })).toBe(false)
    }
    expect(await health().get(model)).toBeUndefined()
  } finally { await rm(root, { recursive: true, force: true }) }
})


test("out-of-order native quota events retain the strongest expiry across restart and replay", async () => {
  const root = await mkdtemp(join(tmpdir(), "native-quota-order-"))
  let time = 2000
  const model = { providerID: "free", id: "beam" }
  const health = () => createNativeModelPolicyHealth(join(root, "health.json"), { now: () => time })
  const failure = { message: "quota", taskID: "task", sessionID: "session", failureID: "newer", occurredAt: 2000, quota: { type: "provider.free-limit" as const, status: 429 as const, retryAfterMs: 100 } }
  try {
    await health().observe(model, failure)
    const older = { ...failure, failureID: "older", occurredAt: 1000, quota: { ...failure.quota, retryAfterMs: 5000 } }
    await health().observe(model, older)
    expect(await health().get(model)).toMatchObject({ failureID: "older", observedAt: 1000, unavailableUntil: 6000 })
    await health().observe(model, { ...failure, occurredAt: 2000, quota: { ...failure.quota, retryAfterMs: 10000 } })
    expect((await health().get(model))?.unavailableUntil).toBe(6000)
    time = 6001
    await health().observe(model, older)
    expect(await health().get(model)).toBeUndefined()
  } finally { await rm(root, { recursive: true, force: true }) }
})
