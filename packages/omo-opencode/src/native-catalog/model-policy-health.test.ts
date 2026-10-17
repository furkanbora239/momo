import { describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createNativeModelPolicyHealth } from "./model-policy-health"

describe("observed native model privacy policy", () => {
  it("quarantines only the rejected model, persists across restart, and expires", async () => {
    const root = mkdtempSync(join(tmpdir(), "native-policy-"))
    let time = 1000
    try {
      const file = join(root, "health.json")
      const blocked = { providerID: "go", id: "contributor" }
      const store = createNativeModelPolicyHealth(file, { now: () => time, ttlMs: 100 })
      expect(await store.observe(blocked, { message: "This Go model trains on request data. Privacy settings prohibit this model.", taskID: "task", sessionID: "session", failureID: "message-1" })).toBe(true)
      expect(await store.get(blocked)).toMatchObject({ reason: "observed_privacy_policy_rejection", taskID: "task", sessionID: "session", failureID: "message-1" })
      expect(await store.get({ providerID: "go", id: "other" })).toBeUndefined()
      expect(await createNativeModelPolicyHealth(file, { now: () => time }).get(blocked)).toBeDefined()
      time = 1050
      await store.observe(blocked, { message: "This Go model trains on request data. Privacy settings prohibit this model.", taskID: "new-task", sessionID: "new-session", failureID: "message-2" })
      time = 1151
      await store.observe(blocked, { message: "This Go model trains on request data. Privacy settings prohibit this model.", taskID: "task", sessionID: "session", failureID: "message-1" })
      expect(await store.get(blocked)).toBeUndefined()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it("does not classify generic access, quota, network or prose errors as privacy policy", async () => {
    const root = mkdtempSync(join(tmpdir(), "native-policy-"))
    try {
      const store = createNativeModelPolicyHealth(join(root, "health.json"))
      for (const message of ["401 Unauthorized", "quota exceeded", "socket closed", "Please document privacy settings", "failed to fetch"]) {
        expect(await store.observe({ providerID: "go", id: "model" }, { message, taskID: "task", sessionID: "session", failureID: "message-1" })).toBe(false)
      }
      expect(await store.get({ providerID: "go", id: "model" })).toBeUndefined()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
})

it("a new native failure in the same task/session renews quarantine while an old message cannot", async () => {
  const root = mkdtempSync(join(tmpdir(), "native-policy-attempt-"))
  let time = 1000
  try {
    const health = createNativeModelPolicyHealth(join(root, "policy.json"), { now: () => time, ttlMs: 100 })
    const model = { providerID: "go", id: "blocked" }
    const failure = { message: "Model trains on request data. Privacy settings prohibit it.", taskID: "task", sessionID: "same-session" }
    await health.observe(model, { ...failure, failureID: "message-1" })
    time = 1101
    await health.observe(model, { ...failure, failureID: "message-1" })
    expect(await health.get(model)).toBeUndefined()
    await health.observe(model, { ...failure, failureID: "message-2" })
    expect((await health.get(model))?.unavailableUntil).toBe(1201)
    time = 1202
    await health.observe(model, { ...failure, failureID: "message-1" })
    expect(await health.get(model)).toBeUndefined()
  } finally { rmSync(root, { recursive: true, force: true }) }
})


it("delayed older native failures do not shorten a newer quarantine or renew after expiry", async () => {
  const root = mkdtempSync(join(tmpdir(), "native-policy-delayed-"))
  let time = 1050
  try {
    const health = createNativeModelPolicyHealth(join(root, "policy.json"), { now: () => time, ttlMs: 100 })
    const model = { providerID: "go", id: "blocked" }
    const failure = { message: "Model trains on request data. Privacy settings prohibit it.", taskID: "task", sessionID: "session" }
    await health.observe(model, { ...failure, failureID: "newer", occurredAt: 1050 })
    await health.observe(model, { ...failure, failureID: "delayed", occurredAt: 1000 })
    expect(await health.get(model)).toMatchObject({ failureID: "newer", observedAt: 1050, unavailableUntil: 1150 })
    time = 1151
    await health.observe(model, { ...failure, failureID: "delayed", occurredAt: 1000 })
    expect(await health.get(model)).toBeUndefined()
  } finally { rmSync(root, { recursive: true, force: true }) }
})
