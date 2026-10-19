import type { JevCallResult } from "@oh-my-opencode/decision-core"
import type { JobClassificationBatch } from "./job-classification-codec"
import type { createJobClassificationStore } from "./job-classification-store"
import type { JobClassDefinitions, JobClassificationInput, JobClassificationUsageReceipt } from "./job-classification-types"

export type JobClassificationAdmission = { readonly allowed: true } | { readonly allowed: false; readonly reason: string }
export interface JobClassificationExecutorOptions {
  readonly statePath: string
  readonly profileStore: ReturnType<typeof createJobClassificationStore>
  readonly getInputs: () => readonly JobClassificationInput[] | Promise<readonly JobClassificationInput[]>
  readonly currentDefinitions: () => JobClassDefinitions | Promise<JobClassDefinitions>
  readonly isEligible: (input: JobClassificationInput) => boolean | Promise<boolean>
  readonly currentRevision?: () => string
  readonly admission?: () => JobClassificationAdmission | Promise<JobClassificationAdmission>
  /**
   * Sole paid-transport owner. Must enforce shared manager/provider/budget admission,
   * durably persist HTTP intent and authoritative usage BEFORE returning or throwing,
   * including failed transport and malformed paid answers. receiptID references that
   * durable usage ledger. This scheduler never creates or estimates a billing receipt.
   */
  readonly executeAudited: (input: { readonly batch: JobClassificationBatch; readonly intentID: string }) => Promise<{ readonly result: JevCallResult; readonly receipt: JobClassificationUsageReceipt }>
  readonly now?: () => number
}
export interface JobClassificationExecutorStatus {
  readonly queued: number
  readonly inflight: number
  readonly failed: number
  readonly paused: number
  readonly batches: number
  readonly completedProfiles: number
  readonly staleProfiles: number
  readonly lastReceiptID?: string
  readonly pauseReason?: string
  readonly running: boolean
  readonly backgroundRunning: boolean
  /** Retained across restart when storage is available; otherwise visible in memory. */
  readonly lastError?: string
}

/** Only the audited transport owner may report a verified no-HTTP admission refusal. */
export class JobClassificationNoSendError extends Error {
  constructor(reason: string) { super(reason); this.name = "JobClassificationNoSendError" }
}
