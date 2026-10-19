import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { JevCallResult } from "@oh-my-opencode/decision-core"
import { createJobClassificationBatch, decodeJobClassificationBatch as decodeBatch } from "./job-classification-codec"
import { captureJobClassificationUsage } from "./job-classification-usage"
import { createJobClassificationStore } from "./job-classification-store"
import type { JobClassDefinitions, JobClassificationInput } from "./job-classification-types"

const definitions: JobClassDefinitions = {
  version: "jobs-v1", classifierVersion: "classification-v1",
  classes: [{ id: "coding", description: "Implement software" }, { id: "research", description: "Find and evaluate sources" }],
}
const model: JobClassificationInput = {
  model: { providerID: "fixture", id: "one" },
  evidence: [{ source: "opencode.model.list", facts: { toolCall: true, contextLength: 10000 } }],
}
function answer(batch: ReturnType<typeof createJobClassificationBatch>, choice = "suitable"): JevCallResult {
  return {
    model: "fixture-jev", answers: Object.fromEntries(Object.keys(batch.questions).map((key) => [key,
      { type: "choice", choice, confidence: 0.9, probabilities: { [choice]: 0.9, [choice === "unknown" ? "suitable" : "unknown"]: 0.1 } }])),
    usage: { inputTokens: 1000, outputTokens: 90000 }, latencyMs: 1, costUsd: 99,
  }
}
function decodeJobClassificationBatch(batch: Parameters<typeof decodeBatch>[0], result: JevCallResult, at: string) {
  return decodeBatch(batch, result, at, captureJobClassificationUsage("fixture-receipt", [{ input_tokens: 1000, output_tokens: 90000 }]))
}
const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
function store() {
  const directory = mkdtempSync(join(tmpdir(), "momo-job-class-"))
  directories.push(directory)
  const path = join(directory, "profiles.json")
  return { path, current: createJobClassificationStore(path) }
}

describe("persistent model job classifications", () => {
  test("given unchanged facts, restart reuses multi-class recommendations and only queues new models", () => {
    const { path, current } = store()
    expect(current.pending(definitions, [model], 2)).toEqual([model])
    const batch = createJobClassificationBatch(definitions, [model])
    const result = decodeJobClassificationBatch(batch, answer(batch), "2026-10-16T00:00:00Z")
    current.save(result)
    const restarted = createJobClassificationStore(path)
    expect(restarted.pending(definitions, [model, { ...model, model: { ...model.model, id: "two" } }], 1)).toHaveLength(1)
    expect(restarted.read(definitions, model)?.memberships.map((entry) => entry.classId)).toEqual(["coding", "research"])
    expect(restarted.read(definitions, model)?.provenance).toBe("jev-recommendation")
  })
  test("given changed facts, definitions or classifier version, cached profiles invalidate", () => {
    const { current } = store()
    const batch = createJobClassificationBatch(definitions, [model])
    current.save(decodeJobClassificationBatch(batch, answer(batch), "2026-10-16T00:00:00Z"))
    expect(current.read(definitions, { ...model, evidence: [{ source: "opencode.model.list", facts: { toolCall: false } }] })).toBeUndefined()
    expect(current.read({ ...definitions, version: "jobs-v2" }, model)).toBeUndefined()
    expect(current.read({ ...definitions, classifierVersion: "v2" }, model)).toBeUndefined()
    expect(current.read({ ...definitions, classes: [{ id: "coding", description: "Changed semantics" }] }, model)).toBeUndefined()
    expect(current.pending(definitions, [model], 0)).toEqual([])
  })
  test("given reordered evidence and classes, semantic cache identity remains stable", () => {
    const { current } = store()
    const input = { ...model, evidence: [...model.evidence, { source: "https://fixture.invalid", facts: { strengths: ["coding"] } }] }
    const batch = createJobClassificationBatch(definitions, [input])
    current.save(decodeJobClassificationBatch(batch, answer(batch), "2026-10-16T00:00:00Z"))
    expect(current.read({ ...definitions, classes: [...definitions.classes].reverse() }, { ...input, evidence: [...input.evidence].reverse() })).toBeDefined()
  })
  test("given no evidence, cold-start classification remains unknown and is persisted without retry loops", () => {
    const { current, path } = store()
    const unknown = { ...model, evidence: [] }
    const batch = createJobClassificationBatch(definitions, [unknown])
    current.save(decodeJobClassificationBatch(batch, answer(batch), "2026-10-16T00:00:00Z"))
    expect(current.read(definitions, unknown)?.memberships.every((entry) => entry.suitability === "unknown")).toBe(true)
    expect(createJobClassificationStore(path).pending(definitions, [unknown], 1)).toEqual([])
  })
  test("given a bounded batch, only its models are transmitted and input tokens alone determine cost", () => {
    const batch = createJobClassificationBatch(definitions, [model])
    expect(JSON.parse(batch.state).models).toHaveLength(1)
    expect(Object.keys(batch.questions)).toHaveLength(2)
    const result = decodeJobClassificationBatch(batch, answer(batch), "2026-10-16T00:00:00Z")
    expect(result.usage).toEqual({ source: "audited-http", receiptID: "fixture-receipt", status: "known", inputTokens: 1000, outputTokens: 90000, costUsd: 0.000042 })
    expect(() => createJobClassificationBatch(definitions, Array.from({ length: 5 }, (_, index) => ({ ...model, model: { ...model.model, id: `${index}` } })))).toThrow()
    expect(() => createJobClassificationBatch(definitions, [model, model])).toThrow()
  })
  test("given insufficient evidence reported by Jev, unknown survives restart without inventing a default class", () => {
    const { current, path } = store()
    const batch = createJobClassificationBatch(definitions, [model])
    current.save(decodeJobClassificationBatch(batch, answer(batch, "unknown"), "2026-10-16T00:00:00Z"))
    const profile = createJobClassificationStore(path).read(definitions, model)
    expect(profile?.memberships.every((entry) => entry.suitability === "unknown")).toBe(true)
    expect(profile?.memberships.some((entry) => entry.classId === "worker")).toBe(false)
    expect(current.pending(definitions, [model], 1)).toEqual([])
  })
  test("given malformed persisted profiles, reads fail closed and malformed responses do not change disk", () => {
    const { current, path } = store()
    const batch = createJobClassificationBatch(definitions, [model])
    current.save(decodeJobClassificationBatch(batch, answer(batch), "2026-10-16T00:00:00Z"))
    const saved = readFileSync(path, "utf8")
    expect(() => current.save({ ...decodeJobClassificationBatch(batch, answer(batch), "2026-10-16T00:00:00Z"), usage: { inputTokens: 1, outputTokens: 0, costUsd: 10 } })).toThrow()
    expect(readFileSync(path, "utf8")).toBe(saved)
    const data = JSON.parse(saved)
    const key = Object.keys(data.profiles)[0]
    data.profiles[key].memberships[0].classId = "worker"
    writeFileSync(path, JSON.stringify(data))
    expect(() => createJobClassificationStore(path).read(definitions, model)).toThrow()
  })
  test("given malformed or incomplete answers, no partial profile is accepted", () => {
    const batch = createJobClassificationBatch(definitions, [model])
    const valid = answer(batch)
    expect(() => decodeJobClassificationBatch(batch, { ...valid, answers: {} }, "2026-10-16T00:00:00Z")).toThrow()
    expect(() => decodeJobClassificationBatch(batch, answer(batch, "worker"), "2026-10-16T00:00:00Z")).toThrow()
    expect(() => createJobClassificationBatch({ ...definitions, classes: [definitions.classes[0], definitions.classes[0]] }, [model])).toThrow()
  })
})

test("probability protocol rejects empty, wrong mass, unsupported keys and a missing selected option", () => {
  const batch = createJobClassificationBatch(definitions, [model])
  const valid = answer(batch)
  for (const probabilities of [{}, { suitable: 0.1 }, { suitable: 0.9, worker: 0.1 }, { unknown: 1 }, { suitable: Number.NaN }, { suitable: 1.1, unknown: -0.1 }]) {
    const answers = { ...valid.answers, m0c0: { type: "choice" as const, choice: "suitable", confidence: 0.9, probabilities } }
    expect(() => decodeJobClassificationBatch(batch, { ...valid, answers }, "2026-10-16T00:00:00Z")).toThrow()
  }
  const answers = { ...valid.answers, m0c0: { type: "choice" as const, choice: "suitable", confidence: 0.9, probabilities: { suitable: 0.9, unknown: 0.09 } } }
  expect(decodeJobClassificationBatch(batch, { ...valid, answers }, "2026-10-16T00:00:00Z").profiles).toHaveLength(1)
})
test("audited usage stays unknown when raw usage is absent despite client zero defaults", () => {
  const batch = createJobClassificationBatch(definitions, [model])
  const result = { ...answer(batch), usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0 }
  const receipt = captureJobClassificationUsage("missing-raw", [undefined])
  expect(receipt.status).toBe("unknown")
  expect(decodeBatch(batch, result, "2026-10-16T00:00:00Z", receipt).usage.costUsd).toBeUndefined()
  const audited = captureJobClassificationUsage("observed", [{ input_tokens: 123, output_tokens: 99999 }])
  expect(decodeBatch(batch, result, "2026-10-16T00:00:00Z", audited).usage.inputTokens).toBe(123)
  expect(audited.costUsd).toBe(123 * 0.042 / 1_000_000)
})
test("usage receipt accounts retries and survives a later malformed classification decode", () => {
  const batch = createJobClassificationBatch(definitions, [model])
  const receipt = captureJobClassificationUsage("attempts", [{ input_tokens: 100 }, { input_tokens: 200 }])
  expect(receipt.inputTokens).toBe(300)
  expect(() => decodeBatch(batch, { ...answer(batch), answers: {} }, "2026-10-16T00:00:00Z", receipt)).toThrow()
  expect(receipt.costUsd).toBe(300 * 0.042 / 1_000_000)
  expect(captureJobClassificationUsage("incomplete", [{ input_tokens: 100 }, undefined]).status).toBe("unknown")
  expect(captureJobClassificationUsage("malformed", [{ input_tokens: -1 }]).status).toBe("unknown")
  expect(captureJobClassificationUsage("observed-zero", [{ input_tokens: 0 }]).costUsd).toBe(0)
})
