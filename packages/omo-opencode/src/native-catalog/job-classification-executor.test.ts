import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import type { JevCallResult } from "@oh-my-opencode/decision-core"
import type { JobClassificationBatch } from "./job-classification-codec"
import type { JobClassDefinitions, JobClassificationInput } from "./job-classification-types"
import { createJobClassificationStore } from "./job-classification-store"
import { captureJobClassificationUsage } from "./job-classification-usage"
import { JobClassificationNoSendError } from "./job-classification-executor-types"
import { createJobClassificationExecutor } from "./job-classification-executor"

const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const input = (id: string, revision = 1): JobClassificationInput => ({ model: { providerID: "fixture", id }, evidence: [{ source: "sdk", facts: { revision } }] })
function answer(batch: JobClassificationBatch, choice = "suitable"): JevCallResult {
  return { model: "jev-fixture", latencyMs: 1, costUsd: 999, usage: { inputTokens: 999, outputTokens: 999 }, answers: Object.fromEntries(Object.keys(batch.questions).map(key => [key, { type: "choice", choice, confidence: 1, probabilities: { [choice]: 1 } }])) }
}
function fixture(classCount = 2) {
  const dir = mkdtempSync(join(tmpdir(), "momo-classifier-executor-")); dirs.push(dir)
  let inputs = [input("one")], definitions: JobClassDefinitions = { version: "v1", classifierVersion: "v1", classes: Array.from({ length: classCount }, (_, i) => ({ id: "class" + i, description: "Job " + i })) }
  let eligible = true, revision = "1", allowed = true, malformed = false, choice = "suitable"
  let failure: Error | undefined
  let calls = 0, active = 0, maxActive = 0, hold: Promise<void> | undefined, release: (() => void) | undefined
  const batches: JobClassificationBatch[] = [], ledger: string[] = []
  const profileStore = createJobClassificationStore(join(dir, "profiles.json")), statePath = join(dir, "executor.json")
  const make = () => createJobClassificationExecutor({
    statePath, profileStore, getInputs: () => inputs, currentDefinitions: () => definitions, isEligible: () => eligible,
    currentRevision: () => revision, admission: () => allowed ? { allowed: true } : { allowed: false, reason: "provider disabled" },
    executeAudited: async ({ batch, intentID }) => {
      if (failure) throw failure
      calls++; active++; maxActive = Math.max(maxActive, active); batches.push(batch)
      // Fixture receipt ledger is durable before returning even a malformed semantic result.
      ledger.push(intentID); writeFileSync(join(dir, "usage.json"), JSON.stringify(ledger))
      await hold; active--
      return { result: malformed ? { ...answer(batch), answers: {} } : answer(batch, choice), receipt: captureJobClassificationUsage(intentID, [{ input_tokens: 100, output_tokens: 1 }]) }
    },
  })
  return { make, profileStore, statePath, batches, ledger, inputs: (next: JobClassificationInput[]) => { inputs = next }, definitions: (next: JobClassDefinitions) => { definitions = next }, eligible: (value: boolean) => { eligible = value }, revision: (value: string) => { revision = value }, allowed: (value: boolean) => { allowed = value }, malformed: () => { malformed = true }, choice: (value: string) => { choice = value }, failure: (value: Error | undefined) => { failure = value }, calls: () => calls, maxActive: () => maxActive, hold: () => { hold = new Promise<void>(resolve => { release = resolve }) }, release: () => { release?.(); hold = undefined } }
}
test("given unchanged cached facts, restart sends no calls; new models and changed facts send only pending models", async () => {
  const f = fixture(); await f.make().pump(); expect(f.calls()).toBe(1)
  await f.make().pump(); expect(f.calls()).toBe(1)
  f.inputs([input("one"), input("two")]); await f.make().pump(); expect(f.batches[1]?.entries.map(row => row.input.model.id)).toEqual(["two"])
  f.inputs([input("one", 2), input("two")]); await f.make().pump(); expect(f.batches[2]?.entries.map(row => row.input.model.id)).toEqual(["one"])
})
test("given concurrent pumps, only one bounded HTTP batch executes", async () => {
  const f = fixture(); f.inputs(Array.from({ length: 9 }, (_, i) => input(String(i)))); f.hold(); const executor = f.make()
  const first = executor.pump(), second = executor.pump(); await Bun.sleep(10); expect(f.calls()).toBe(1); f.release(); await Promise.all([first, second]); expect(f.maxActive()).toBe(1); expect(f.batches[0]?.entries).toHaveLength(4)
  await executor.pump(); expect(f.calls()).toBe(2); expect(f.batches[1]?.entries).toHaveLength(4)
})
test("given malformed paid answers, failure persists across ticks and restart without another HTTP request", async () => {
  const f = fixture(); f.malformed(); const executor = f.make(); await executor.pump(); await executor.pump(); await f.make().pump()
  expect(f.calls()).toBe(1); expect(f.ledger).toHaveLength(1); expect(executor.status().failed).toBe(1); expect(executor.status().lastReceiptID).toBe(f.ledger[0])
})
test("given unknown recommendations, the unknown profile remains cached across restart", async () => {
  const f = fixture(); f.choice("unknown"); await f.make().pump(); await f.make().pump()
  expect(f.calls()).toBe(1); expect(f.profileStore.read(f.batches[0]!.definitions, input("one"))?.memberships.every(row => row.suitability === "unknown")).toBe(true)
})
test("given facts changing during HTTP, a stale answer cannot label the changed model", async () => {
  const f = fixture(); f.hold(); const executor = f.make(), pending = executor.pump(); await Bun.sleep(10); f.inputs([input("one", 2)]); f.release(); await pending
  expect(f.profileStore.read(f.batches[0]!.definitions, input("one", 2))).toBeUndefined(); expect(executor.status().staleProfiles).toBe(1)
  await executor.pump(); expect(f.calls()).toBe(2); expect(f.profileStore.read(f.batches[1]!.definitions, input("one", 2))).toBeDefined()
})
test("given a disabled provider, durable pause resumes only after explicit retry or changed eligibility revision", async () => {
  const f = fixture(); f.allowed(false); const executor = f.make(); await executor.pump(); expect(f.calls()).toBe(0); expect(executor.status().pauseReason).toBe("provider disabled")
  f.allowed(true); await f.make().pump(); expect(f.calls()).toBe(0); executor.retry(); await executor.pump(); expect(f.calls()).toBe(1)
  f.inputs([input("two")]); f.allowed(false); await executor.pump(); f.allowed(true); f.revision("2"); await executor.pump(); expect(f.calls()).toBe(2)
})
test("given ineligible inputs, no HTTP occurs until eligibility revision changes", async () => {
  const f = fixture(); f.eligible(false); const executor = f.make(); await executor.pump(); expect(f.calls()).toBe(0)
  f.eligible(true); await executor.pump(); expect(f.calls()).toBe(0); f.revision("2"); await executor.pump(); expect(f.calls()).toBe(1)
})
test("given many classes, batch size derives from the question limit", async () => {
  const f = fixture(11); f.inputs(Array.from({ length: 7 }, (_, i) => input(String(i)))); await f.make().pump()
  expect(f.batches[0]?.entries).toHaveLength(2); expect(Object.keys(f.batches[0]!.questions)).toHaveLength(22)
})
test("given oversized evidence, queue records failure while smaller later inputs proceed", async () => {
  const f = fixture(); f.inputs([{ ...input("huge"), evidence: [{ source: "sdk", facts: { value: "x".repeat(25000) } }] }, input("small")]); const executor = f.make(); await executor.pump()
  expect(f.calls()).toBe(1); expect(f.batches[0]?.entries[0]?.input.model.id).toBe("small"); expect(executor.status().failed).toBe(1); expect(Buffer.byteLength(f.batches[0]!.state)).toBeLessThanOrEqual(24000)
})
test("given persisted inflight intent after crash, restart pauses ambiguous paid work without replay", async () => {
  const f = fixture(); f.hold(); const pending = f.make().pump(); await Bun.sleep(10)
  const restarted = f.make(); await restarted.pump(); expect(f.calls()).toBe(1); expect(restarted.status().failed).toBe(1)
  f.release(); await pending
})
test("given malformed durable executor state, no HTTP call is allowed", async () => {
  const f = fixture(); writeFileSync(f.statePath, JSON.stringify({ version: 99 })); expect(() => f.make()).toThrow(); expect(f.calls()).toBe(0)
})

test("given the audited owner rejects before HTTP, its pause resumes on an eligibility revision", async () => {
  const f = fixture(); f.failure(new JobClassificationNoSendError("manager unavailable")); const executor = f.make()
  await executor.pump(); expect(executor.status().paused).toBe(1); expect(f.calls()).toBe(0)
  f.failure(undefined); await executor.pump(); expect(f.calls()).toBe(0); f.revision("2"); await executor.pump(); expect(f.calls()).toBe(1)
})
test("given a transport failure, repeated ticks and restart never blindly replay potentially paid HTTP", async () => {
  const f = fixture(); f.failure(new Error("ambiguous paid transport")); const executor = f.make()
  await executor.pump(); expect(executor.status().failed).toBe(1); f.failure(undefined); await f.make().pump(); expect(f.calls()).toBe(0)
  executor.retry(); await executor.pump(); expect(f.calls()).toBe(1)
})
test("given definitions change during HTTP, old recommendations are rejected and new definitions are classified next", async () => {
  const f = fixture(); f.hold(); const executor = f.make(), pending = executor.pump(); await Bun.sleep(10)
  const definitions = { ...f.batches[0]!.definitions, classifierVersion: "v2" }; f.definitions(definitions); f.release(); await pending
  expect(f.profileStore.read(definitions, input("one"))).toBeUndefined(); await executor.pump(); expect(f.calls()).toBe(2); expect(f.profileStore.read(definitions, input("one"))).toBeDefined()
})
test("given eligibility disappears during HTTP, paid output cannot create an eligible profile", async () => {
  const f = fixture(); f.hold(); const executor = f.make(), pending = executor.pump(); await Bun.sleep(10); f.eligible(false); f.release(); await pending
  expect(f.profileStore.read(f.batches[0]!.definitions, input("one"))).toBeUndefined(); expect(executor.status().paused).toBe(1); expect(executor.status().staleProfiles).toBe(1)
})
test("given combined state exceeds the byte cap, only a fitting subset is sent", async () => {
  const f = fixture(); f.inputs(["one", "two"].map(id => ({ ...input(id), evidence: [{ source: "sdk", facts: { detail: "x".repeat(13000) } }] })))
  await f.make().pump(); expect(f.batches[0]?.entries).toHaveLength(1); expect(Buffer.byteLength(f.batches[0]!.state)).toBeLessThanOrEqual(24000)
})
test("given more classes than the question cap, the item fails durably with no HTTP", async () => {
  const f = fixture(33); const executor = f.make(); await executor.pump(); await executor.pump(); expect(f.calls()).toBe(0); expect(executor.status().failed).toBe(1)
})
test("given a background batch, stop awaits it and prevents subsequent scheduled batches", async () => {
  const f = fixture(); f.inputs(Array.from({ length: 9 }, (_, i) => input(String(i)))); f.hold(); const executor = f.make(); executor.start(100)
  const end = Date.now() + 1000; while (f.calls() === 0 && Date.now() < end) await Bun.sleep(10)
  expect(f.calls()).toBe(1); const stopping = executor.stop(); f.release(); await stopping; await Bun.sleep(120)
  expect(f.calls()).toBe(1); expect(executor.status().running).toBe(false); expect(executor.status().queued).toBe(5)
})
