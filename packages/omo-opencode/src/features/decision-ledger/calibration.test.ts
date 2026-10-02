import { describe, test, expect } from "bun:test"

import { analyzeDecisionLedger, bucketLowerBound } from "./calibration"
import type { DecisionLedgerEntryWithOutcome } from "./types"

function entry(
  confidence: number,
  status?: "success" | "failure" | "timeout",
): DecisionLedgerEntryWithOutcome {
  return {
    id: `id-${Math.random()}`,
    ts: 0,
    session: "s",
    task: { description: "d", promptExcerpt: "p" },
    stage1: { questions: {}, answers: {}, confidence, latencyMs: 0 },
    resolved: {},
    source: "jev",
    usage: { inputTokens: 0, costUsd: 0 },
    outcome: status ? { decisionId: "x", ts: 0, status, durationMs: 0 } : undefined,
  } as DecisionLedgerEntryWithOutcome
}

describe("analyzeDecisionLedger", () => {
  test("#given buckets with high success rates #when analyzed #then suggests lowest qualifying boundary", () => {
    const entries = [
      entry(0.05, "success"),
      entry(0.15, "success"),
      entry(0.25, "failure"),
      entry(0.95, "success"),
    ]
    const report = analyzeDecisionLedger(entries, 0.85)

    const b0 = report.buckets.find((b) => b.lowerBound === 0.0)!
    expect(b0.decisionCount).toBe(1)
    expect(b0.outcomeCount).toBe(1)
    expect(b0.successRate).toBe(1)
    expect(report.suggestedThreshold).toBe(0.0)
  })

  test("#given no bucket meets target #when analyzed #then suggests 0.95 fallback", () => {
    const entries = [entry(0.5, "failure"), entry(0.6, "failure")]
    const report = analyzeDecisionLedger(entries, 0.85)
    expect(report.suggestedThreshold).toBe(0.95)
  })

  test("#given bucket with no outcomes #when analyzed #then successRate null and excluded from suggestion", () => {
    const entries = [entry(0.95)]
    const report = analyzeDecisionLedger(entries, 0.85)
    const b = report.buckets.find((x) => x.lowerBound === 0.9)!
    expect(b.decisionCount).toBe(1)
    expect(b.successRate).toBeNull()
    expect(report.suggestedThreshold).toBe(0.95)
  })

  test("bucketLowerBound clamps and floors to the 0.1 grid", () => {
    expect(bucketLowerBound(0.0)).toBe(0.0)
    expect(bucketLowerBound(0.34)).toBe(0.3)
    expect(bucketLowerBound(0.95)).toBe(0.9)
    expect(bucketLowerBound(1.0)).toBe(0.9)
    expect(bucketLowerBound(-0.5)).toBe(0.0)
    expect(bucketLowerBound(Number.NaN)).toBe(0.0)
  })
})
