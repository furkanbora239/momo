import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import {
  analyzeDecisionLedger,
  type CalibrationReport,
} from "../packages/omo-opencode/src/features/decision-ledger/calibration"
import type { DecisionLedgerEntryWithOutcome } from "../packages/omo-opencode/src/features/decision-ledger/types"

type CliArgs = {
  ledger?: string
  targetRate?: number
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {}
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]
    if (token === "--ledger") {
      args.ledger = argv[++i]
    } else if (token === "--target-rate") {
      const value = Number(argv[++i])
      if (Number.isFinite(value)) args.targetRate = value
    }
  }
  return args
}

function readLedger(ledgerPath: string): DecisionLedgerEntryWithOutcome[] {
  if (!existsSync(ledgerPath)) return []
  const raw = readFileSync(ledgerPath, "utf-8")
  const entries: DecisionLedgerEntryWithOutcome[] = []
  for (const line of raw.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    try {
      entries.push(JSON.parse(trimmed) as DecisionLedgerEntryWithOutcome)
    } catch {
      // Skip malformed lines; the ledger reader tolerates the same.
    }
  }
  return entries
}

function printReport(report: CalibrationReport): void {
  console.log(`target-rate=${report.targetRate}`)
  console.log("bucket        decisions  outcomes  success-rate")
  for (const bucket of report.buckets) {
    const rate = bucket.successRate === null ? "n/a" : bucket.successRate.toFixed(3)
    console.log(
      `${bucket.bucket.padEnd(13)} ${String(bucket.decisionCount).padStart(9)} ${String(bucket.outcomeCount).padStart(9)} ${rate.padStart(12)}`,
    )
  }
  console.log(`suggested-threshold=${report.suggestedThreshold}`)
}

export async function runCalibrateDecisionThreshold(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv)
  const ledgerPath = args.ledger ?? join(homedir(), ".omo", "decision-ledger.jsonl")
  const targetRate = args.targetRate ?? 0.85

  const entries = readLedger(ledgerPath)
  const report = analyzeDecisionLedger(entries, targetRate)
  printReport(report)
  return 0
}

if (import.meta.main) {
  const exitCode = await runCalibrateDecisionThreshold(Bun.argv.slice(2))
  process.exit(exitCode)
}
