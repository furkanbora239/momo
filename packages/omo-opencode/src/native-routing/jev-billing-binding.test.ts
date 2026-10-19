import { expect, test } from "bun:test"
import { createNativeJevAccountant } from "./jev-accountant"
import { executeAuditedNativeJev, createNativeJevBackend } from "./jev-adapter"
import { parseNativeLedgerRecord } from "./ledger-validation"
import type { NativeLedgerRecord, NativeRouterStore } from "./types"

const binding = { model: "jev-1.13-free", endpoint: "https://opencode.ai/zen/v1/systemone" }

test("given transport changes an admitted free destination, HTTP is never sent", async () => {
  const rows: NativeLedgerRecord[] = []
  const store: NativeRouterStore = { load: async () => rows, append: async row => { rows.push(row) }, exportLines: async () => [] }
  const accountant = createNativeJevAccountant({ store, monthlyBudgetUsd: 1 })
  let requests = 0
  await expect(accountant.run({ callId: "mismatch", purpose: "routing", inputDigest: "a".repeat(64), billingBinding: binding }, audit =>
    executeAuditedNativeJev({ model: binding.model, baseUrl: "https://custom.invalid/v1", session: "fixture", getApiKey: () => "fixture", maxAttempts: 1,
      postJson: async () => { requests++; return { status: 200, body: {} } } }, client => client.ask("{}", {}), { audit })))
    .rejects.toThrow("billing binding differs")
  expect(requests).toBe(0)
  expect(accountant.receipt("mismatch")?.status).toBe("not_sent")
})

test("given canonical billing binding fields, validation preserves valid records and rejects malformed fields", () => {
  const record = { version: 1, type: "jev_call", callId: "fixture", purpose: "routing", inputDigest: "a".repeat(64),
    createdAt: "2026-10-19T00:00:00Z", status: "complete", billingBinding: binding, usage: { costUsd: 0 } }
  expect(parseNativeLedgerRecord(record)).toEqual(record)
  expect(parseNativeLedgerRecord({ ...record, billingBinding: { model: 3, endpoint: binding.endpoint } })).toBeUndefined()
  expect(parseNativeLedgerRecord({ ...record, billingBinding: { model: binding.model, endpoint: "file:///tmp/free" } })).toBeUndefined()
  expect(parseNativeLedgerRecord({ ...record, billingBinding: undefined })).toBeDefined()
})

test("given a native Jev backend, its configured HTTP binding is exposed to the router", () => {
  expect(createNativeJevBackend({ model: binding.model, session: "fixture", getApiKey: () => undefined }).billingBinding).toEqual(binding)
  expect(createNativeJevBackend({ model: binding.model, baseUrl: "https://opencode.ai/zen/v1/", session: "fixture", getApiKey: () => undefined }).billingBinding).toEqual(binding)
})
