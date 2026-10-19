// MODIFIED: momo catalog recommendations share routing's durable Jev accountant.
import { createHash } from "node:crypto"
import { join } from "node:path"
import type { JevClientDeps } from "@oh-my-opencode/decision-core"
import { createJobClassificationExecutor } from "../native-catalog/job-classification-executor"
import { JobClassificationNoSendError } from "../native-catalog/job-classification-executor-types"
import { createJobClassificationStore } from "../native-catalog/job-classification-store"
import type { JobClassificationBatch } from "../native-catalog/job-classification-codec"
import type { JobClassDefinitions, JobClassificationInput, JobClassificationUsageReceipt } from "../native-catalog/job-classification-types"
import { executeAuditedNativeJev, nativeJevFailureNotSent } from "../native-routing/jev-adapter"
import type { NativeJevAccountant } from "../native-routing/jev-accountant"
import type { NativeJevCallRecord, NativeModelRef } from "../native-routing/types"

function classificationReceipt(record: NativeJevCallRecord): JobClassificationUsageReceipt {
  const usage = record.usage
  const common = { source: "audited-http" as const, receiptID: record.callId,
    ...(Number.isSafeInteger(usage?.outputTokens) && usage!.outputTokens! >= 0 ? { outputTokens: usage!.outputTokens } : {}) }
  return Number.isSafeInteger(usage?.inputTokens) && usage!.inputTokens! >= 0 && usage?.costUsd !== undefined
    ? { ...common, status: "known", inputTokens: usage.inputTokens!, costUsd: usage.costUsd }
    : { ...common, status: "unknown" }
}

export function createNativeJobClassifier(options: {
  readonly onError?: (error: unknown) => void
  readonly directory: string
  readonly profileCacheDirectory?: string
  readonly accountant: NativeJevAccountant
  readonly jev: JevClientDeps
  readonly definitions: () => JobClassDefinitions
  readonly getInputs: () => Promise<readonly JobClassificationInput[]>
  readonly currentInput: (model: NativeModelRef) => JobClassificationInput | undefined
  readonly isEligible: (input: JobClassificationInput) => boolean | Promise<boolean>
  readonly revision: () => string
  /** Recheck manager activation and every batch model's provider/pool immediately before each HTTP. */
  readonly assertBatchEligible: (batch: JobClassificationBatch) => Promise<void>
}) {
  const store = createJobClassificationStore(join(options.directory, "job-classifications.json"), { sharedDirectory: options.profileCacheDirectory })
  const executor = createJobClassificationExecutor({
    statePath: join(options.directory, "job-classification-maintenance.json"), profileStore: store,
    currentDefinitions: options.definitions, getInputs: options.getInputs, isEligible: options.isEligible, currentRevision: options.revision,
    async executeAudited({ batch, intentID }) {
      try {
        const { value, receipt } = await options.accountant.run({ callId: `classification:${intentID}`, purpose: "classification",
          inputDigest: createHash("sha256").update(JSON.stringify({ state: batch.state, questions: batch.questions })).digest("hex") },
        (audit) => executeAuditedNativeJev(options.jev, (client) => client.ask(batch.state, batch.questions), {
          audit, beforeRequest: () => options.assertBatchEligible(batch),
        }))
        return { result: value.value, receipt: classificationReceipt(receipt) }
      } catch (error) {
        if (nativeJevFailureNotSent(error)) throw new JobClassificationNoSendError(error instanceof Error ? error.message : String(error))
        throw error
      }
    },
  })
  let preparation: Promise<ReturnType<typeof executor.status>> | undefined
  let generation = 0
  /** The background queue normally warms the catalog first. A task joins the same
   * single-flight work, never starts another research agent or reclassifies cached profiles. */
  function prepare() {
    if (preparation) return preparation
    const preparingGeneration = generation
    preparation = (async () => {
      let status = await executor.pump()
      const modelsPerBatch = Math.max(1, Math.min(4, Math.floor(32 / options.definitions().classes.length)))
      const remainingPasses = Math.min(64, Math.ceil(status.queued / modelsPerBatch) + 1)
      let previous = ""
      for (let pass = 0; pass < remainingPasses && status.queued > 0 && generation === preparingGeneration; pass++) {
        const progress = JSON.stringify([status.queued, status.batches, status.completedProfiles, status.staleProfiles, status.failed, status.paused])
        if (progress === previous) return status
        previous = progress
        status = await executor.pump()
      }
      return status
    })().finally(() => { preparation = undefined })
    return preparation
  }
  return {
    prepare,
    start(intervalMs = 30_000) {
      if (executor.status().backgroundRunning) return
      executor.start(intervalMs)
      void prepare().catch(error => options.onError?.(error))
    },
    async stop() { generation++; await executor.stop(); await preparation },
    status: executor.status, retry: executor.retry,
    definitions: options.definitions,
    memberships(model: NativeModelRef) {
      const input = options.currentInput(model)
      return input ? store.read(options.definitions(), input)?.memberships : undefined
    },
  }
}
