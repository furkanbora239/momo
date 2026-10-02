import type { DecisionLedgerEntryWithOutcome } from "./types"

export type ConfidenceBucket = {
  readonly bucket: string
  readonly lowerBound: number
  readonly decisionCount: number
  readonly outcomeCount: number
  readonly successCount: number
  /** null when no backfilled outcome exists for the bucket yet. */
  readonly successRate: number | null
}

export type CalibrationReport = {
  readonly buckets: readonly ConfidenceBucket[]
  readonly suggestedThreshold: number
  readonly targetRate: number
}

/** Map a stage1 path confidence to the lower bound of its 0.1-wide bucket. */
export function bucketLowerBound(confidence: number): number {
  if (!Number.isFinite(confidence)) return 0
  const clamped = Math.min(1, Math.max(0, confidence))
  return Math.min(0.9, Math.floor(clamped * 10) / 10)
}

/**
 * Read-only analysis of the decision ledger for threshold calibration. Buckets
 * the stage1 path confidence into 0.0-0.1 ... 0.9-1.0 and reports, per bucket,
 * the decision count and the outcome success rate (over backfilled outcomes
 * where present). The suggested threshold is the lowest bucket boundary whose
 * success rate meets the target; if no bucket qualifies we fall back to 0.95.
 */
export function analyzeDecisionLedger(
  entries: readonly DecisionLedgerEntryWithOutcome[],
  targetRate: number,
): CalibrationReport {
  type MutableBucket = {
    bucket: string
    lowerBound: number
    decisionCount: number
    outcomeCount: number
    successCount: number
    successRate: number | null
  }

  const buckets = new Map<number, MutableBucket>()
  for (let i = 0; i < 10; i++) {
    const lower = i / 10
    buckets.set(lower, {
      bucket: `${lower.toFixed(1)}-${(lower + 0.1).toFixed(1)}`,
      lowerBound: lower,
      decisionCount: 0,
      outcomeCount: 0,
      successCount: 0,
      successRate: null,
    })
  }

  for (const entry of entries) {
    const confidence = entry.stage1?.confidence
    if (typeof confidence !== "number") continue
    const bucket = buckets.get(bucketLowerBound(confidence))
    if (!bucket) continue
    bucket.decisionCount += 1
    if (entry.outcome) {
      bucket.outcomeCount += 1
      if (entry.outcome.status === "success") bucket.successCount += 1
    }
  }

  const ordered = [...buckets.values()].sort((a, b) => a.lowerBound - b.lowerBound)
  for (const bucket of ordered) {
    bucket.successRate = bucket.outcomeCount > 0 ? bucket.successCount / bucket.outcomeCount : null
  }

  let suggestedThreshold = 0.95
  for (const bucket of ordered) {
    if (bucket.successRate !== null && bucket.successRate >= targetRate) {
      suggestedThreshold = bucket.lowerBound
      break
    }
  }

  return { buckets: ordered, suggestedThreshold, targetRate }
}
