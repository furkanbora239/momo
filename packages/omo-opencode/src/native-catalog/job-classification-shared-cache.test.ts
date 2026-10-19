import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createJobClassificationBatch, decodeJobClassificationBatch } from "./job-classification-codec"
import { createJobClassificationStore } from "./job-classification-store"
import type { JobClassDefinitions, JobClassificationInput } from "./job-classification-types"
const directories: string[] = []
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }) })
const definitions: JobClassDefinitions = { version: "1", classifierVersion: "1", classes: [{ id: "coding", description: "Code" }] }
const input: JobClassificationInput = { model: { providerID: "fixture", id: "one" }, evidence: [{ source: "sdk", facts: { tools: true } }] }
function result(defs = definitions, source = input, suitability = "suitable") {
  const batch = createJobClassificationBatch(defs, [source])
  return decodeJobClassificationBatch(batch, { model: "fixture", answers: Object.fromEntries(Object.keys(batch.questions).map(key => [key, { type: "choice", choice: suitability, confidence: 1, probabilities: { [suitability]: 1 } }])), usage: { inputTokens: 100, outputTokens: 999 }, costUsd: 0, latencyMs: 1 }, "2026-10-18T00:00:00Z", { source: "audited-http", receiptID: "owner-receipt", status: "known", inputTokens: 100, costUsd: 100 * 0.042 / 1_000_000 })
}
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "momo-job-shared-")); directories.push(directory)
  const sharedDirectory = join(directory, "shared")
  return { sharedDirectory, make: (name: string) => createJobClassificationStore(join(directory, name + ".json"), { sharedDirectory }) }
}
test("given separate project snapshots, immutable fingerprints preserve facts and definition variants", async () => {
  const f = fixture(), a = f.make("a"), b = f.make("b"), c = f.make("c")
  const changed = { ...input, evidence: [{ source: "sdk", facts: { tools: false } }] }, changedDefs = { ...definitions, version: "2" }
  await Promise.all([Promise.resolve().then(() => a.save(result())), Promise.resolve().then(() => b.save(result(changedDefs, changed)))])
  expect(c.read(definitions, input)).toBeDefined(); expect(c.read(changedDefs, changed)).toBeDefined()
  expect(c.read(definitions, changed)).toBeUndefined(); expect(c.read(changedDefs, input)).toBeUndefined()
  expect(c.read({ ...definitions, classifierVersion: "2" }, input)).toBeUndefined()
  expect(readdirSync(f.sharedDirectory)).toHaveLength(2)
  const file = join(f.sharedDirectory, result().profiles[0]!.fingerprint + ".json"), before = readFileSync(file, "utf8")
  b.save(result(definitions, input, "unsuitable"))
  expect(readFileSync(file, "utf8")).toBe(before); expect(c.read(definitions, input)?.memberships[0]?.suitability).toBe("suitable")
  expect(JSON.parse(before).usage).toBeUndefined()
})
test("given a corrupt shared fingerprint, reads fail closed instead of admitting an untrusted profile", () => {
  const f = fixture(), a = f.make("a"), b = f.make("b"), value = result(); a.save(value)
  const path = join(f.sharedDirectory, value.profiles[0]!.fingerprint + ".json")
  writeFileSync(path, JSON.stringify({ ...value.profiles[0], fingerprint: "0".repeat(64) }))
  expect(() => b.read(definitions, input)).toThrow("classification store")
  expect(() => b.pending(definitions, [input], 1)).toThrow("classification store")
})
