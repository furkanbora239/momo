import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createNativeJobClassifier } from "./job-classifier"
import { createNativeJevAccountant } from "../native-routing/jev-accountant"
import type { NativeLedgerRecord, NativeRouterStore } from "../native-routing/types"
import type { JobClassificationInput } from "../native-catalog/job-classification-types"
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture(budget = 1, model = "jev-1.13") {
  const directory = mkdtempSync(join(tmpdir(), "momo-job-factory-")); dirs.push(directory)
  const rows: NativeLedgerRecord[] = [], batches: string[][] = []
  const ledger: NativeRouterStore = { load: async () => rows, append: async row => { rows.push(structuredClone(row)) }, exportLines: async () => rows.map(row => JSON.stringify(row)) }
  let inputs: JobClassificationInput[] = [{ model: { providerID: "fixture", id: "one" }, evidence: [{ source: "sdk", facts: { tools: true } }] }], malformed = false, churn = false, revision = "1"
  let hold: Promise<void> | undefined, release: (() => void) | undefined
  const accountant = createNativeJevAccountant({ store: ledger, monthlyBudgetUsd: budget })
  const make = (targetDirectory = directory, profileCacheDirectory?: string, selectedAccountant = accountant) => createNativeJobClassifier({ directory: targetDirectory, accountant: selectedAccountant, profileCacheDirectory,
    definitions: () => ({ version: "v1", classifierVersion: "v1", classes: [{ id: "coding", description: "Code" }] }),
    getInputs: async () => inputs, currentInput: model => inputs.find(input => input.model.id === model.id), isEligible: () => true, revision: () => revision,
    assertBatchEligible: async () => undefined,
    jev: { model, session: "fixture", getApiKey: () => "fixture", maxAttempts: 1, postJson: async (_url, _headers, body) => {
      const state = JSON.parse(body.state) as { models: { model: { id: string } }[] }
      batches.push(state.models.map(row => row.model.id))
      await hold
      if (churn) {
        inputs = inputs.map(input => ({ ...input, evidence: [{ source: "sdk", facts: { revision: batches.length } }] }))
        if (batches.length >= 10) return { status: 400, body: { error: "bounded test fuse" } }
      }
      return { status: 200, body: { usage: { input_tokens: 100, output_tokens: 1 }, answers: malformed ? {} : Object.fromEntries(Object.keys(body.questions).map(key => [key, { type: "choice", choice: "suitable", confidence: 1, probabilities: { suitable: 1 } }])) } }
    } },
  })
  return { directory, make, batches, rows, accountant, inputs: (next: JobClassificationInput[]) => { inputs = next; revision += "x" }, malformed: () => { malformed = true }, churn: () => { churn = true }, hold: () => { hold = new Promise<void>(resolve => { release = resolve }) }, release: () => { release?.(); hold = undefined } }
}
test("given a prepared catalog, repeated prepare and restart reuse unchanged profiles without HTTP", async () => {
  const f = fixture(), classifier = f.make(); await classifier.prepare(); await classifier.prepare(); await f.make().prepare()
  expect(f.batches).toEqual([["one"]]); expect(classifier.memberships({ providerID: "fixture", id: "one" })?.[0]?.suitability).toBe("suitable")
})
test("given changed facts and new entries, only pending models are reclassified in bounded batches", async () => {
  const f = fixture(); await f.make().prepare()
  f.inputs(Array.from({ length: 7 }, (_, i) => ({ model: { providerID: "fixture", id: i ? String(i) : "one" }, evidence: [{ source: "sdk", facts: { tools: true, revision: 2 } }] })))
  await f.make().prepare(); expect(f.batches.slice(1).flat()).toHaveLength(7); expect(f.batches.every(batch => batch.length <= 4)).toBe(true)
  await f.make().prepare(); expect(f.batches).toHaveLength(3)
})
test("given malformed paid output, the shared accountant preserves spend and blocks a distinct later routing call", async () => {
  const f = fixture(100 * 0.042 / 1_000_000); f.malformed(); const classifier = f.make(); await classifier.prepare()
  expect(classifier.status().failed).toBe(1); expect(f.batches).toHaveLength(1)
  await expect(f.accountant.run({ callId: "next-route", purpose: "routing", inputDigest: "a".repeat(64) }, async () => 1)).rejects.toThrow("budget cap")
  await f.make().prepare(); expect(f.batches).toHaveLength(1)
})

test("given facts change continuously during paid responses, prepare returns within a finite batch bound", async () => {
  const f = fixture(); f.churn(); const classifier = f.make(); const status = await classifier.prepare()
  expect(f.batches.length).toBeLessThanOrEqual(3); expect(status.queued).toBeGreaterThan(0)
})

test("given stop during startup warming, it drains the active batch and prevents more preparation calls", async () => {
  const f = fixture(); f.inputs(Array.from({ length: 7 }, (_, i) => ({ model: { providerID: "fixture", id: String(i) }, evidence: [{ source: "sdk", facts: { tools: true } }] })))
  f.hold(); const classifier = f.make(); classifier.start()
  const deadline = Date.now() + 1000; while (f.batches.length === 0 && Date.now() < deadline) await Bun.sleep(1)
  expect(f.batches).toHaveLength(1); const stopping = classifier.stop(); f.release(); await stopping; await Bun.sleep(20)
  expect(f.batches).toHaveLength(1); expect(classifier.status().queued).toBe(3)
})


test("given a second project, unchanged shared profiles reuse classification without HTTP or importing spend", async () => {
  const f = fixture(), shared = join(f.directory, "shared"), otherRows: NativeLedgerRecord[] = []
  const otherLedger: NativeRouterStore = { load: async () => otherRows, append: async row => { otherRows.push(structuredClone(row)) }, exportLines: async () => otherRows.map(row => JSON.stringify(row)) }
  const otherAccountant = createNativeJevAccountant({ store: otherLedger, monthlyBudgetUsd: 1 })
  await f.make(join(f.directory, "project-a"), shared).prepare()
  const other = f.make(join(f.directory, "project-b"), shared, otherAccountant)
  await other.prepare(); await f.make(join(f.directory, "project-a"), shared).prepare()
  expect(f.batches).toEqual([["one"]]); expect(otherRows).toEqual([])
  expect(other.memberships({ providerID: "fixture", id: "one" })?.[0]?.suitability).toBe("suitable")
  expect(f.rows.filter(row => row.type === "jev_call" && row.status === "complete")).toHaveLength(1)
  f.inputs([{ model: { providerID: "fixture", id: "one" }, evidence: [{ source: "sdk", facts: { tools: false } }] }])
  await other.prepare(); expect(f.batches).toHaveLength(2)
  expect(otherRows.filter(row => row.type === "jev_call" && row.status === "complete")).toHaveLength(1)
})


test("given explicit free Jev, classification persists zero-cost receipts and reuses profiles after restart", async () => {
  const f = fixture(0.00000001, "jev-1.13-free"), classifier = f.make()
  await classifier.prepare()
  expect(classifier.status().completedProfiles).toBe(1)
  expect(classifier.status().failed).toBe(0)
  expect(f.rows.findLast(row => row.type === "jev_call")).toMatchObject({ status: "complete", usage: { inputTokens: 100, costUsd: 0 } })
  const restarted = f.make(); await restarted.prepare()
  expect(f.batches).toHaveLength(1)
  expect(restarted.memberships({ providerID: "fixture", id: "one" })?.[0]?.suitability).toBe("suitable")
  f.inputs([{ model: { providerID: "fixture", id: "two" }, evidence: [{ source: "sdk", facts: { tools: true } }] }])
  await restarted.prepare()
  expect(f.batches).toHaveLength(2)
  expect(restarted.status().failed).toBe(0)
})
