// MODIFIED: momo persistent job suitability recommendations, separate from native roles.
import type { NativeModelRef } from "../native-routing/types"

export interface JobClassDefinitions {
  readonly version: string
  readonly classifierVersion: string
  readonly classes: readonly { readonly id: string; readonly description: string }[]
}

export interface JobClassificationInput {
  readonly model: NativeModelRef
  /** Source-backed SDK metadata or researched facts, never previous suitability recommendations. */
  readonly evidence: readonly { readonly source: string; readonly facts: Readonly<Record<string, unknown>> }[]
}

export interface JobClassificationProfile {
  readonly model: NativeModelRef
  readonly definitions: JobClassDefinitions
  readonly evidence: JobClassificationInput["evidence"]
  readonly fingerprint: string
  readonly provenance: "jev-recommendation"
  readonly classifiedAt: string
  readonly memberships: readonly {
    readonly classId: string
    readonly suitability: "suitable" | "unsuitable" | "unknown"
    readonly confidence: number
  }[]
}

export interface JobClassificationResult {
  readonly version: 1
  readonly profiles: readonly JobClassificationProfile[]
  readonly usage: JobClassificationUsageReceipt
}

/** Must reference an executor-owned durable HTTP usage ledger, including failed/malformed attempts. */
export type JobClassificationUsageReceipt = {
  readonly source: "audited-http"
  readonly receiptID: string
  readonly outputTokens?: number
} & (
  | { readonly status: "known"; readonly inputTokens: number; readonly costUsd: number }
  | { readonly status: "unknown"; readonly inputTokens?: undefined; readonly costUsd?: undefined }
)
