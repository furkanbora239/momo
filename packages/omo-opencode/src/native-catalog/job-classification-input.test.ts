import { describe, expect, test } from "bun:test"
import { createJobClassDefinitions } from "./job-class-definitions"
import { jobClassificationInput } from "./job-classification-input"
import { jobClassificationFingerprint } from "./job-classification-identity"

const model = { providerID: "local", id: "model", available: true, toolCall: true, capabilities: ["text", "text"] }
const knowledge = { model, known: true, source: "https://example.org/model", summary: "Code and reasoning", verifiedAt: "2026-10-16T00:00:00Z" }
describe("job classification source inputs", () => {
  test("ignores transient availability, pricing, observation time and capability order", () => {
    // given source-equivalent catalog observations
    const definitions = createJobClassDefinitions()
    const before = jobClassificationInput(model, knowledge)
    const after = jobClassificationInput({ ...model, available: false, inputPricePerMillion: 10, capabilities: ["text"] }, { ...knowledge, verifiedAt: "2026-10-17T00:00:00Z" })
    // when fingerprints are computed then the recommendation remains reusable
    expect(jobClassificationFingerprint(definitions, before)).toBe(jobClassificationFingerprint(definitions, after))
  })
  test("source content changes invalidate the cached classification", () => {
    const definitions = createJobClassDefinitions()
    const before = jobClassificationInput(model, knowledge)
    const after = jobClassificationInput(model, { ...knowledge, summary: "Image-only processing" })
    expect(jobClassificationFingerprint(definitions, before)).not.toBe(jobClassificationFingerprint(definitions, after))
  })
  test("rejects cross-model, unknown and uncited research", () => {
    const plain = jobClassificationInput(model)
    expect(jobClassificationInput(model, { ...knowledge, model: { ...model, id: "other" } })).toEqual(plain)
    expect(jobClassificationInput(model, { ...knowledge, known: false })).toEqual(plain)
    expect(jobClassificationInput(model, { ...knowledge, source: " " })).toEqual(plain)
    expect(jobClassificationInput({ providerID: "local", id: "empty", available: true }).evidence).toEqual([])
  })
  test("validates bounded unique job classes separately from roles", () => {
    expect(createJobClassDefinitions([{ id: "coding", description: "Software" }]).classes).toHaveLength(1)
    expect(() => createJobClassDefinitions([{ id: "coding", description: "A" }, { id: "coding", description: "B" }])).toThrow()
    expect(() => createJobClassDefinitions([])).toThrow()
    expect(() => createJobClassDefinitions(Array.from({ length: 33 }, (_, i) => ({ id: String(i), description: "D" })))).toThrow()
  })
})

test("classification preserves source modalities and fingerprints output capability changes", () => {
  const definitions = createJobClassDefinitions()
  const source = { ...model, inputModalities: ["image", "text", "text"], outputModalities: ["text"] }
  const first = jobClassificationInput(source)
  expect(first.evidence[0]?.facts.inputModalities).toEqual(["image", "text"])
  expect(first.evidence[0]?.facts.outputModalities).toEqual(["text"])
  expect(jobClassificationFingerprint(definitions, first)).toBe(jobClassificationFingerprint(definitions, jobClassificationInput({ ...source, inputModalities: ["text", "image"] })))
  expect(jobClassificationFingerprint(definitions, first)).not.toBe(jobClassificationFingerprint(definitions, jobClassificationInput({ ...source, outputModalities: ["image"] })))
})
