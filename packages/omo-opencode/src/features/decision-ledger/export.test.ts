import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  exportDecisionTrainingSet,
  type DecisionTrainingRecord,
} from "./export"
import type { DecisionLedgerEntryWithOutcome } from "./types"

const testDirectories: string[] = []

afterEach(() => {
  while (testDirectories.length > 0) {
    const directory = testDirectories.pop()
    if (directory) rmSync(directory, { recursive: true, force: true })
  }
})

function createTestDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "omo-decision-export-"))
  testDirectories.push(directory)
  return directory
}

function fullJevEntry(id: string): DecisionLedgerEntryWithOutcome {
  return {
    id,
    ts: 1,
    session: "sess_test",
    task: { description: `task ${id}`, promptExcerpt: `prompt ${id}` },
    stage1: {
      questions: { path: { type: "choice" }, effort: { type: "score" } },
      answers: {
        path: { type: "choice", choice: "quick", confidence: 0.9, probabilities: { quick: 0.9, explore: 0.1 } },
        effort: { type: "score", score: 2, confidence: 0.8, legend: ["low", "high"] },
      },
      latencyMs: 10,
    },
    candidates: [{ name: "a/b", priceLine: "$0.04/M", strength: "fast" }],
    stage2: {
      questions: { model: { type: "choice" }, lane: { type: "choice" } },
      answers: {
        model: { type: "choice", choice: "a/b", confidence: 0.9, probabilities: { "a/b": 0.7, "c/d": 0.3 } },
        lane: { type: "choice", choice: "fast", confidence: 0.9, probabilities: { fast: 0.8, slow: 0.2 } },
      },
      latencyMs: 12,
    },
    resolved: { path: "quick", effort: 2, model: "a/b", lane: "fast" },
    source: "jev",
    usage: { inputTokens: 100, costUsd: 0.01 },
  }
}

function stage1OnlyFallbackEntry(id: string): DecisionLedgerEntryWithOutcome {
  return {
    id,
    ts: 2,
    session: "sess_test",
    task: { description: `fallback ${id}`, promptExcerpt: `fprompt ${id}` },
    stage1: {
      questions: {},
      answers: {
        path: { type: "choice", choice: "quick", confidence: 0.5, probabilities: { quick: 0.5 } },
        effort: { type: "score", score: 1, confidence: 0.5, legend: ["low", "high"] },
      },
      latencyMs: 5,
    },
    resolved: { path: "quick", effort: 1 },
    source: "fallback",
    reason: "low-confidence-stage1",
    usage: { inputTokens: 0, costUsd: 0 },
  }
}

function writeLedger(directory: string, entries: unknown[]): string {
  const ledgerPath = join(directory, "decision-ledger.jsonl")
  const content = entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
  writeFileSync(ledgerPath, content, "utf-8")
  return ledgerPath
}

function readOutput(outputPath: string): DecisionTrainingRecord[] {
  const raw = readFileSync(outputPath, "utf-8")
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l) as DecisionTrainingRecord)
}

describe("exportDecisionTrainingSet", () => {
  test("#given a full jev ledger #when exporting #then the record round-trips all fields", async () => {
    // given
    const directory = createTestDirectory()
    const ledgerPath = writeLedger(directory, [fullJevEntry("e1")])
    const outputPath = join(directory, "out.jsonl")

    // when
    const result = await exportDecisionTrainingSet({ ledgerPath, outputPath })

    // then
    expect(result.exported).toBe(1)
    expect(result.skipped).toBe(0)
    const records = readOutput(outputPath)
    expect(records).toHaveLength(1)
    const record = records[0]
    expect(record.id).toBe("e1")
    expect(record.source).toBe("jev")
    expect(record.stage).toBe("full")
    expect(record.state).toContain("task e1")
    expect(record.state).toContain("prompt e1")
    expect(record.answers.path.label).toBe("quick")
    expect(record.answers.path.probabilities).toEqual({ quick: 0.9, explore: 0.1 })
    expect(record.answers.effort.label).toBe(2)
    expect(record.answers.effort.distribution).toEqual({ score: 2, legend: ["low", "high"] })
    expect(record.answers.model.label).toBe("a/b")
    expect(record.answers.model.probabilities).toEqual({ "a/b": 0.7, "c/d": 0.3 })
    expect(record.answers.lane.label).toBe("fast")
    expect(record.answers.lane.probabilities).toEqual({ fast: 0.8, slow: 0.2 })
    expect(record.outcome).toBeUndefined()
    expect(record.usage).toEqual({ inputTokens: 100, costUsd: 0.01 })
  })

  test("#given a ledger with a malformed line #when exporting #then it is counted as skipped and not thrown", async () => {
    // given
    const directory = createTestDirectory()
    const ledgerPath = join(directory, "decision-ledger.jsonl")
    // The middle line is intentionally unparseable JSON (unbalanced braces), so it
    // must be counted as skipped rather than crashing the export.
    const content = [
      JSON.stringify(fullJevEntry("e1")),
      "{not valid json",
      JSON.stringify(fullJevEntry("e2")),
    ].join("\n") + "\n"
    writeFileSync(ledgerPath, content, "utf-8")
    const outputPath = join(directory, "out.jsonl")

    // when
    const result = await exportDecisionTrainingSet({ ledgerPath, outputPath })

    // then
    expect(result.exported).toBe(2)
    expect(result.skipped).toBe(1)
    const records = readOutput(outputPath)
    expect(records.map((r) => r.id).sort()).toEqual(["e1", "e2"])
  })

  test("#given a stage1-only fallback entry #when exporting #then it is marked stage1-only with labels and no stage2 probabilities", async () => {
    // given
    const directory = createTestDirectory()
    const ledgerPath = writeLedger(directory, [stage1OnlyFallbackEntry("f1")])
    const outputPath = join(directory, "out.jsonl")

    // when
    const result = await exportDecisionTrainingSet({ ledgerPath, outputPath })

    // then
    expect(result.exported).toBe(1)
    const record = readOutput(outputPath)[0]
    expect(record.stage).toBe("stage1-only")
    expect(record.source).toBe("fallback")
    expect(record.reason).toBe("low-confidence-stage1")
    expect(record.answers.path.label).toBe("quick")
    expect(record.answers.path.probabilities).toEqual({ quick: 0.5 })
    expect(record.answers.effort.label).toBe(1)
    expect(record.answers.effort.distribution).toEqual({ score: 1, legend: ["low", "high"] })
    expect(record.answers.model.label).toBeUndefined()
    expect(record.answers.model.probabilities).toBeUndefined()
    expect(record.answers.lane.label).toBeUndefined()
    expect(record.answers.lane.probabilities).toBeUndefined()
  })

  test("#given mixed source entries #when filtering by source #then only matching rows export", async () => {
    // given
    const directory = createTestDirectory()
    const ledgerPath = writeLedger(directory, [fullJevEntry("e1"), stage1OnlyFallbackEntry("f1")])
    const outJev = join(directory, "jev.jsonl")
    const outFallback = join(directory, "fallback.jsonl")

    // when
    const jevResult = await exportDecisionTrainingSet({
      ledgerPath,
      outputPath: outJev,
      filter: { source: "jev" },
    })
    const fallbackResult = await exportDecisionTrainingSet({
      ledgerPath,
      outputPath: outFallback,
      filter: { source: "fallback" },
    })

    // then
    expect(jevResult.exported).toBe(1)
    expect(readOutput(outJev)[0].id).toBe("e1")
    expect(fallbackResult.exported).toBe(1)
    expect(readOutput(outFallback)[0].id).toBe("f1")
  })

  test("#given entries with and without outcomes #when filtering by hasOutcome #then only matching rows export", async () => {
    // given
    const directory = createTestDirectory()
    const withOutcome = { ...fullJevEntry("e1"), outcome: { decisionId: "e1", ts: 3, status: "success" as const, durationMs: 42 } }
    const withoutOutcome = fullJevEntry("e2")
    const ledgerPath = writeLedger(directory, [withOutcome, withoutOutcome])
    const outHas = join(directory, "has.jsonl")
    const outMissing = join(directory, "missing.jsonl")

    // when
    const hasResult = await exportDecisionTrainingSet({
      ledgerPath,
      outputPath: outHas,
      filter: { hasOutcome: true },
    })
    const missingResult = await exportDecisionTrainingSet({
      ledgerPath,
      outputPath: outMissing,
      filter: { hasOutcome: false },
    })

    // then
    expect(hasResult.exported).toBe(1)
    const hasRecord = readOutput(outHas)[0]
    expect(hasRecord.id).toBe("e1")
    expect(hasRecord.outcome).toEqual({ status: "success", durationMs: 42 })
    expect(missingResult.exported).toBe(1)
    expect(readOutput(outMissing)[0].id).toBe("e2")
  })

  test("#given an output path in a missing directory #when exporting #then the parent directory is created", async () => {
    // given
    const directory = createTestDirectory()
    const ledgerPath = writeLedger(directory, [fullJevEntry("e1")])
    const outputPath = join(directory, "nested", "deep", "out.jsonl")

    // when
    await exportDecisionTrainingSet({ ledgerPath, outputPath })

    // then
    expect(existsSync(outputPath)).toBe(true)
    expect(readOutput(outputPath)).toHaveLength(1)
  })

  test("#given multiple entries #when exporting #then output preserves ledger order deterministically", async () => {
    // given
    const directory = createTestDirectory()
    const ledgerPath = writeLedger(directory, [
      fullJevEntry("e1"),
      stage1OnlyFallbackEntry("f1"),
      fullJevEntry("e2"),
    ])
    const outputPath = join(directory, "out.jsonl")

    // when
    await exportDecisionTrainingSet({ ledgerPath, outputPath })

    // then
    const ids = readOutput(outputPath).map((r) => r.id)
    expect(ids).toEqual(["e1", "f1", "e2"])
  })

  test("#given an empty ledger path #when exporting #then it produces an empty output with zero counts", async () => {
    // given
    const directory = createTestDirectory()
    const ledgerPath = join(directory, "does-not-exist.jsonl")
    const outputPath = join(directory, "out.jsonl")

    // when
    const result = await exportDecisionTrainingSet({ ledgerPath, outputPath })

    // then
    expect(result).toEqual({ exported: 0, skipped: 0 })
    expect(existsSync(outputPath)).toBe(true)
    expect(readFileSync(outputPath, "utf-8")).toBe("")
  })
})
