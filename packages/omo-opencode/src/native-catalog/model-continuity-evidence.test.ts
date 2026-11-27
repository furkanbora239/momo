import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { nativeModelRejectionSummary, parseNativeModelRejection } from "./model-continuity-evidence"
import { createNativeModelPolicyHealth } from "./model-policy-health"

test("native payment evidence distinguishes account balance from a rejected model without exporting provider response data", () => {
  const unscoped = { type: "provider.quota", status: 402, message: "reject" }
  const account = { ...unscoped, response: { body: JSON.stringify({ error: { code: "insufficient_balance", unrelated: "do not persist" } }) } }
  const model = { ...unscoped, response: { body: JSON.stringify({ error: { code: "model_payment_required" } }) } }
  expect(parseNativeModelRejection(account)).toMatchObject({ kind: "payment_required", scope: "provider" })
  expect(parseNativeModelRejection(model)).toMatchObject({ kind: "payment_required", scope: "model" })
  expect(parseNativeModelRejection(unscoped)).toMatchObject({ kind: "payment_required", scope: "model" })
  expect(nativeModelRejectionSummary(account)).toEqual(JSON.stringify({ type: "provider.quota", status: 402 }))
  expect(parseNativeModelRejection({ type: "provider.overloaded", status: 503 })).toBeUndefined()
  expect(parseNativeModelRejection({ type: "unknown", status: 402 })).toBeUndefined()
})

test("only an account finding temporarily excludes other models on its provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "momo-402-evidence-"))
  try {
    let now = 5000
    const store = () => createNativeModelPolicyHealth(join(root, "health.json"), { now: () => now })
    const model = { providerID: "a", id: "worker" }
    const sibling = { providerID: "a", id: "another" }
    const unrelated = { providerID: "b", id: "worker" }
    const source = { message: "payment", taskID: "task", sessionID: "session", occurredAt: now }
    await store().observe(model, { ...source, failureID: "model-failure", rejection: { kind: "payment_required", scope: "model", retryAfterMs: 300_000 } })
    expect(await store().get(model)).toMatchObject({ reason: "observed_model_payment_required" })
    expect(await store().get(sibling)).toBeUndefined()

    now += 250
    const account = { ...source, occurredAt: now, failureID: "account-failure", rejection: { kind: "payment_required", scope: "provider", retryAfterMs: 300_000 } } as const
    await store().observe(model, account)
    const until = now + account.rejection.retryAfterMs
    expect(await store().get(sibling)).toMatchObject({ reason: "observed_provider_payment_required", unavailableUntil: until })
    expect(await store().get(unrelated)).toBeUndefined()

    now = until
    await store().observe(model, account)
    expect(await store().get(sibling)).toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
