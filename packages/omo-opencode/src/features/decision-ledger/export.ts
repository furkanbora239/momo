import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

import type {
  DecisionLedgerEntryWithOutcome,
  DecisionLedgerSource,
} from "./types"

export type TrainingAnswerPath = {
  readonly label: string | undefined
  readonly probabilities: Record<string, number> | undefined
}

export type TrainingAnswerEffort = {
  readonly label: number | undefined
  readonly distribution: { readonly score: number; readonly legend?: readonly string[] } | undefined
}

export type TrainingAnswerModel = {
  readonly label: string | undefined
  readonly probabilities: Record<string, number> | undefined
}

export type TrainingAnswerLane = {
  readonly label: string | undefined
  readonly probabilities: Record<string, number> | undefined
}

export type DecisionTrainingRecord = {
  readonly id: string
  readonly state: string
  readonly questions: { readonly stage1: unknown; readonly stage2: unknown }
  readonly answers: {
    readonly path: TrainingAnswerPath
    readonly effort: TrainingAnswerEffort
    readonly model: TrainingAnswerModel
    readonly lane: TrainingAnswerLane
  }
  readonly outcome?: { readonly status: string; readonly durationMs: number }
  readonly source: DecisionLedgerSource
  readonly reason?: string
  readonly usage: { readonly inputTokens: number; readonly costUsd: number }
  readonly stage: "full" | "stage1-only"
}

export type DecisionExportFilter = {
  readonly source?: DecisionLedgerSource
  readonly hasOutcome?: boolean
}

export type ExportDecisionTrainingSetInput = {
  readonly ledgerPath: string
  readonly outputPath: string
  readonly filter?: DecisionExportFilter
}

export type ExportDecisionTrainingSetResult = {
  readonly exported: number
  readonly skipped: number
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function getField(obj: unknown, key: string): unknown {
  return asRecord(obj)?.[key]
}

function asProbabilities(value: unknown): Record<string, number> | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  for (const v of Object.values(record)) {
    if (typeof v !== "number") return undefined
  }
  return record as Record<string, number>
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function asStringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined
  if (!value.every((v) => typeof v === "string")) return undefined
  return value as readonly string[]
}

function toTrainingRecord(entry: DecisionLedgerEntryWithOutcome): DecisionTrainingRecord {
  const stage1Answers = entry.stage1?.answers
  const stage2Answers = entry.stage2?.answers

  const pathProbabilities = asProbabilities(getField(getField(stage1Answers, "path"), "probabilities"))
  const effortScore = asNumber(getField(getField(stage1Answers, "effort"), "score"))
  const effortLegend = asStringArray(getField(getField(stage1Answers, "effort"), "legend"))
  const modelProbabilities = asProbabilities(getField(getField(stage2Answers, "model"), "probabilities"))
  const laneProbabilities = asProbabilities(getField(getField(stage2Answers, "lane"), "probabilities"))

  const outcome = entry.outcome
    ? { status: entry.outcome.status, durationMs: entry.outcome.durationMs }
    : undefined

  return {
    id: entry.id,
    state: `${entry.task.description}\n${entry.task.promptExcerpt}`,
    questions: {
      stage1: entry.stage1?.questions ?? null,
      stage2: entry.stage2?.questions ?? null,
    },
    answers: {
      path: { label: entry.resolved.path, probabilities: pathProbabilities },
      effort: {
        label: entry.resolved.effort,
        distribution:
          effortScore !== undefined ? { score: effortScore, legend: effortLegend } : undefined,
      },
      model: { label: entry.resolved.model, probabilities: modelProbabilities },
      lane: { label: entry.resolved.lane, probabilities: laneProbabilities },
    },
    outcome,
    source: entry.source,
    reason: entry.reason,
    usage: entry.usage,
    stage: entry.stage2 ? "full" : "stage1-only",
  }
}

function passesFilter(
  entry: DecisionLedgerEntryWithOutcome,
  filter?: DecisionExportFilter,
): boolean {
  if (!filter) return true
  if (filter.source !== undefined && entry.source !== filter.source) return false
  if (filter.hasOutcome !== undefined) {
    const has = entry.outcome !== undefined
    if (filter.hasOutcome !== has) return false
  }
  return true
}

export async function exportDecisionTrainingSet(
  input: ExportDecisionTrainingSetInput,
): Promise<ExportDecisionTrainingSetResult> {
  const { ledgerPath, outputPath, filter } = input
  const raw = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf-8") : ""
  const lines = raw.split("\n")

  const records: DecisionTrainingRecord[] = []
  let skipped = 0

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let parsed: DecisionLedgerEntryWithOutcome
    try {
      parsed = JSON.parse(trimmed) as DecisionLedgerEntryWithOutcome
    } catch {
      skipped += 1
      continue
    }
    if (!passesFilter(parsed, filter)) continue
    records.push(toTrainingRecord(parsed))
  }

  const outputDir = dirname(outputPath)
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }
  const serialized = records.map((r) => JSON.stringify(r)).join("\n")
  writeFileSync(outputPath, serialized.length > 0 ? `${serialized}\n` : "", "utf-8")

  return { exported: records.length, skipped }
}
