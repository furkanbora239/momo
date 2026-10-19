import { afterEach, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { JevCallResult } from "@oh-my-opencode/decision-core"
import { createJobClassificationExecutor } from "./job-classification-executor"
import { JobClassificationNoSendError, type JobClassificationExecutorOptions } from "./job-classification-executor-types"
import { createJobClassificationStore } from "./job-classification-store"
import type { JobClassificationUsageReceipt } from "./job-classification-types"
import { captureJobClassificationUsage } from "./job-classification-usage"
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "momo-executor-review-")); dirs.push(dir)
  let revision = "1", calls = 0
  const options: JobClassificationExecutorOptions = {
    statePath: join(dir, "executor.json"), profileStore: createJobClassificationStore(join(dir, "profiles.json")),
    currentDefinitions: () => ({ version: "v1", classifierVersion: "v1", classes: [{ id: "coding", description: "Code" }] }),
    getInputs: () => [{ model: { providerID: "fixture", id: "one" }, evidence: [{ source: "sdk", facts: { tools: true } }] }],
    isEligible: () => true, currentRevision: () => revision,
    executeAudited: async ({ batch, intentID }) => {
      calls++
      const result: JevCallResult = { model: "fixture", latencyMs: 1, usage: { inputTokens: 100, outputTokens: 1 }, costUsd: 0, answers: Object.fromEntries(Object.keys(batch.questions).map(key => [key, { type: "choice", choice: "suitable", confidence: 1, probabilities: { suitable: 1 } }])) }
      return { result, receipt: captureJobClassificationUsage(intentID, [{ input_tokens: 100, output_tokens: 1 }]) }
    },
  }
  return { options, calls: () => calls, revision: (next: string) => { revision = next } }
}
test("given a malformed audited receipt, durable state remains readable without replay", async () => {
  const f = fixture(), audited = f.options.executeAudited
  const executor = createJobClassificationExecutor({ ...f.options, executeAudited: async request => ({ ...await audited(request), receipt: { receiptID: { injected: true } } as unknown as JobClassificationUsageReceipt }) })
  await executor.pump(); expect(executor.status().lastReceiptID).toBeUndefined(); expect(executor.status().failed).toBe(1)
  const restarted = createJobClassificationExecutor(f.options); await restarted.pump(); expect(f.calls()).toBe(1); expect(restarted.status().failed).toBe(1)
})
test("given background refresh fails, status and restart retain the diagnostic", async () => {
  const f = fixture(), executor = createJobClassificationExecutor({ ...f.options, getInputs: () => { throw new Error("source snapshot unavailable") } })
  executor.start(100); await Bun.sleep(180); await executor.stop()
  expect(executor.status()).toMatchObject({ backgroundRunning: false, running: false, lastError: expect.stringContaining("source snapshot unavailable") })
  expect(createJobClassificationExecutor(f.options).status().lastError).toContain("source snapshot unavailable"); expect(f.calls()).toBe(0)
})
test("given storage becomes unwritable, pump rejects with a visible failure and no send", async () => {
  const f = fixture(), executor = createJobClassificationExecutor(f.options); mkdirSync(f.options.statePath)
  await expect(executor.pump()).rejects.toThrow(); expect(executor.status().lastError).toBeDefined(); expect(f.calls()).toBe(0)
})
test("given a revision changes during no-send admission, the newer revision can resume", async () => {
  const f = fixture(); let release: (() => void) | undefined, started = false, refuse = true
  const executor = createJobClassificationExecutor({ ...f.options, executeAudited: async request => {
    if (refuse) { started = true; await new Promise<void>(resolve => { release = resolve }); throw new JobClassificationNoSendError("provider was disabled") }
    return f.options.executeAudited(request)
  } })
  const pending = executor.pump(); while (!started) await Bun.sleep(1)
  f.revision("2"); refuse = false; release!(); await pending; expect(executor.status().paused).toBe(1)
  await executor.pump(); expect(f.calls()).toBe(1); expect(executor.status().completedProfiles).toBe(1)
})
test("given a revision changes during optional admission, its stale refusal cannot freeze the new revision", async () => {
  const f = fixture(); let release: (() => void) | undefined, started = false, refuse = true
  const executor = createJobClassificationExecutor({ ...f.options, admission: async () => {
    if (refuse) { started = true; await new Promise<void>(resolve => { release = resolve }); return { allowed: false, reason: "disabled" } }
    return { allowed: true }
  } })
  const pending = executor.pump(); while (!started) await Bun.sleep(1)
  f.revision("2"); refuse = false; release!(); await pending; await executor.pump(); expect(f.calls()).toBe(1)
})
