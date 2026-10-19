import { expect, test } from "bun:test"
import { NativeJevAdmissionError } from "@oh-my-opencode/decision-core"
import { createNativeJevAccountant } from "./jev-accountant"
import type { NativeDecisionRecord, NativeJevCallAudit, NativeLedgerRecord, NativeRouterStore } from "./types"
const digest = "a".repeat(64)
function fixture(budget = 0.0000042) {
  const rows: NativeLedgerRecord[] = []; let fail = false, time = Date.parse("2026-10-17T00:00:00Z")
  const store: NativeRouterStore = { load: async () => rows, append: async row => { if (fail) throw new Error("disk unavailable"); rows.push(structuredClone(row)) }, exportLines: async () => rows.map(row => JSON.stringify(row)) }
  const make = () => createNativeJevAccountant({ store, monthlyBudgetUsd: budget, now: () => time })
  return { make, rows, store, fail: () => { fail = true }, month: () => { time = Date.parse("2026-11-01T00:00:00Z") } }
}
const identity = (callId: string, purpose: "routing" | "classification" = "routing") => ({ callId, purpose, inputDigest: digest })
async function paid(audit: NativeJevCallAudit, input = 100) {
  await audit.beforeRequest()
  await audit.recordAttempt({ url: "http://fixture", headers: {}, requestBody: {}, status: 200, responseBody: { usage: { input_tokens: input, output_tokens: 999999 } } })
  return "value"
}
test("given routing and classification compete for the last budget unit, their shared queue permits only one", async () => {
  const f = fixture(), accountant = f.make(); let sends = 0
  const outcomes = await Promise.allSettled([accountant.run(identity("route"), async audit => { sends++; return paid(audit) }), accountant.run(identity("classify", "classification"), async audit => { sends++; return paid(audit) })])
  expect(outcomes.map(row => row.status)).toEqual(["fulfilled", "rejected"]); expect(sends).toBe(1)
  expect(f.rows.filter(row => row.type === "jev_call" && row.status === "complete")[0]).toMatchObject({ usage: { inputTokens: 100, costUsd: 100 * 0.042 / 1_000_000 } })
})
test("given malformed paid output, authoritative billing survives error and restart", async () => {
  const f = fixture(); await expect(f.make().run(identity("bad"), async audit => { await paid(audit); throw new Error("malformed choice") })).rejects.toThrow("malformed choice")
  await expect(f.make().run(identity("later", "classification"), paid)).rejects.toThrow("budget cap")
})
test("given an interrupted pending intent, restart refuses both purposes without executing", async () => {
  const f = fixture(); f.rows.push({ version: 1, type: "jev_call", ...identity("interrupted"), createdAt: "2026-10-17T00:00:00Z", status: "pending", usage: { costUsd: 0 } })
  let calls = 0
  for (const purpose of ["routing", "classification"] as const) await expect(f.make().run(identity(purpose, purpose), async () => { calls++; return 1 })).rejects.toThrow("spend is unknown")
  expect(calls).toBe(0)
})
test("given a sent response omits usage, restart does not invent free spend", async () => {
  const f = fixture(); await f.make().run(identity("missing"), async audit => { await audit.beforeRequest(); await audit.recordAttempt({ url: "http://fixture", headers: {}, requestBody: {}, status: 200, responseBody: {} }); return 1 })
  await expect(f.make().run(identity("later"), paid)).rejects.toThrow("spend is unknown")
})
test("given a stable call identity was already recorded, it is never automatically replayed", async () => {
  const f = fixture(1), accountant = f.make(); await accountant.run(identity("once"), paid)
  await expect(f.make().run(identity("once"), paid)).rejects.toThrow("replay refused")
  await expect(f.make().run({ ...identity("once"), inputDigest: "b".repeat(64) }, paid)).rejects.toThrow("conflicts")
})
test("given a new UTC month, only that month's canonical usage consumes the cap", async () => {
  const f = fixture(), accountant = f.make(); await accountant.run(identity("october"), paid); f.month()
  expect((await accountant.run(identity("november", "classification"), paid)).value).toBe("value")
})
test("given a second HTTP stage is denied, stage one's paid usage remains charged", async () => {
  const f = fixture(), accountant = f.make()
  await expect(accountant.run(identity("stages"), async audit => { await paid(audit); await audit.beforeRequest(); return 1 })).rejects.toThrow("budget cap")
  expect(accountant.receipt("stages")).toMatchObject({ status: "complete", usage: { inputTokens: 100, costUsd: 100 * 0.042 / 1_000_000 } })
})
test("given durable intent cannot append, the execution callback never starts", async () => {
  const f = fixture(); f.fail(); let calls = 0
  await expect(f.make().run(identity("fail"), async () => { calls++; return 1 })).rejects.toThrow("disk unavailable"); expect(calls).toBe(0)
})
test("given a verified admission refusal before HTTP, the canonical record has no charge", async () => {
  const f = fixture(), accountant = f.make()
  await expect(accountant.run(identity("disabled"), async () => { throw new NativeJevAdmissionError("disabled") })).rejects.toThrow("disabled")
  expect(accountant.receipt("disabled")).toMatchObject({ status: "not_sent" }); expect((await f.make().run(identity("reenabled"), paid)).value).toBe("value")
})
test("given final receipt persistence fails after paid HTTP, the intent remains uncertain", async () => {
  const f = fixture(), accountant = f.make()
  await expect(accountant.run(identity("partial"), async audit => { await paid(audit, 1); f.fail(); return 1 })).rejects.toThrow("disk unavailable")
  const restartedStore = { ...f.store, append: async (row: NativeLedgerRecord) => { f.rows.push(row) } }
  await expect(createNativeJevAccountant({ store: restartedStore, monthlyBudgetUsd: 1, now: () => Date.parse("2026-10-17T00:00:00Z") }).run(identity("later"), paid)).rejects.toThrow("spend is unknown")
})

function decision(jevCallId?: string): NativeDecisionRecord {
  return { version: 1, type: "decision", decisionId: "historical", createdAt: "2026-10-17T00:00:00Z", status: "awaiting_selection", candidateSnapshots: [], jevCallId, jevAttempted: true,
    request: { decisionId: "historical", input: { prompt: "fixture", parentRole: "orchestrator", rootSessionID: "root", parentSessionID: "root", kind: "task" }, allowedRoles: [], candidates: [], knowledge: [], outcomes: [], instructions: "" } }
}
test("given a linked attempted decision has no canonical call, its uncertainty still blocks capped calls", async () => {
  const f = fixture(); f.rows.push(decision("missing-call")); let calls = 0
  await expect(f.make().run(identity("later"), async () => { calls++; return 1 })).rejects.toThrow("spend is unknown"); expect(calls).toBe(0)
})
test("given linked decision copies and legacy revisions, each canonical call and latest unlinked decision is counted once", async () => {
  const f = fixture(0.00002), accountant = f.make(); await accountant.run(identity("canonical"), paid)
  f.rows.push({ ...decision("canonical"), decisionId: "linked-copy", request: { ...decision().request, decisionId: "linked-copy" }, jevUsage: { costUsd: 999 } })
  f.rows.push({ ...decision(), jevUsage: { costUsd: 999 } }, { ...decision(), jevUsage: { costUsd: 0 } })
  expect((await f.make().run(identity("later"), paid)).value).toBe("value")
})
test("given no monthly cap, unknown earlier spend does not change uncapped admission", async () => {
  const f = fixture(); f.rows.push({ version: 1, type: "jev_call", ...identity("unknown"), createdAt: "2026-10-17T00:00:00Z", status: "pending" })
  const accountant = createNativeJevAccountant({ store: f.store, now: () => Date.parse("2026-10-17T00:00:00Z") })
  expect((await accountant.run(identity("distinct"), paid)).value).toBe("value")
  await expect(accountant.run(identity("unknown"), paid)).rejects.toThrow("replay refused")
})

test("given a later sent request lacks a receipt, known prior input remains visible while total cost is unknown", async () => {
  const f = fixture(1), accountant = f.make()
  const { receipt } = await accountant.run(identity("partial-usage"), async audit => { await paid(audit); await audit.beforeRequest(); return 1 })
  expect(receipt.usage?.inputTokens).toBe(100); expect(receipt.usage?.costUsd).toBeUndefined()
  await expect(f.make().run(identity("next"), paid)).rejects.toThrow("spend is unknown")
})

function oldAnswer(rawUsage?: unknown, malformed = false) {
  return { role: "worker", model: { providerID: "fixture", id: "one" }, confidence: 1, probabilities: {}, usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
    source: { httpAttempts: [{ url: malformed ? "invalid-url" : "https://fixture.invalid/systemone", headers: {}, requestBody: { model: "jev", state: "{}", questions: {} }, status: 200,
      responseBody: rawUsage === undefined ? {} : { usage: rawUsage } }] } }
}
test("given legacy semantic zero and audited paid input, replay charges the authoritative HTTP receipt", async () => {
  const f = fixture(); f.rows.push({ ...decision(), jevAnswer: oldAnswer({ input_tokens: 100, output_tokens: 9 }) }); let calls = 0
  await expect(f.make().run(identity("later"), async () => { calls++; return 1 })).rejects.toThrow("budget cap"); expect(calls).toBe(0)
})
test("given legacy semantic zero and an audited receipt missing usage, replay pauses unknown spend", async () => {
  const f = fixture(); f.rows.push({ ...decision(), jevAnswer: oldAnswer() }); let calls = 0
  await expect(f.make().run(identity("later"), async () => { calls++; return 1 })).rejects.toThrow("spend is unknown"); expect(calls).toBe(0)
})
test("given legacy semantic zero and a validated audited failure receipt, raw failure usage takes precedence", async () => {
  const f = fixture(); f.rows.push({ ...decision(), jevAnswer: { ...oldAnswer(), source: undefined }, jevFailure: { message: "late failure", rawResponse: oldAnswer({ input_tokens: 100 }) } })
  await expect(f.make().run(identity("later"), paid)).rejects.toThrow("budget cap")
})
test("given an explicit existing F10 usage record, its trusted receipt takes precedence over older embedded evidence", async () => {
  const f = fixture(); f.rows.push({ ...decision(), jevUsage: { costUsd: 0 }, jevAnswer: oldAnswer({ input_tokens: 100000 }) })
  expect((await f.make().run(identity("later"), paid)).value).toBe("value")
})
test("given malformed untrusted HTTP attempt shape, replay does not invent a charge and preserves known legacy compatibility", async () => {
  const f = fixture(); f.rows.push({ ...decision(), jevAnswer: oldAnswer({ input_tokens: 100000 }, true) })
  expect((await f.make().run(identity("later"), paid)).value).toBe("value")
})

test("given an attempted linked decision has no canonical receipt, a semantic zero cannot authorize more spend", async () => {
  const f = fixture(); f.rows.push({ ...decision("missing-call"), jevAttempted: true, jevUsage: { costUsd: 0 } })
  await expect(f.make().run(identity("later"), paid)).rejects.toThrow("spend is unknown")
})
