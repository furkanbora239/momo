import { describe, expect, it } from "bun:test"
import { ModelCardSchema, ModelCatalogSchema, readBundledModelKnowledge } from "./model-cards"

const card = {
  canonical: "vendor/model", aliases: ["model"], summary: "Documented model", strengths: ["Code"], limitations: ["Unknown research quality"],
  sources: ["https://vendor.test/model"], researchedAt: "2026-10-19T00:00:00Z",
}

describe("shared model cards", () => {
  it("reuses exact model identity across providers without sharing provider prices", () => {
    for (const providerID of ["opencode", "new-endpoint"]) {
      const model = { providerID, id: "mimo-v2.6-flash-free" }
      const fact = readBundledModelKnowledge(model)
      expect(fact).toMatchObject({ known: true, model })
      expect(Object.keys(fact!)).toEqual(["model", "known", "summary", "strengths", "limitations", "source", "verifiedAt"])
    }
  })

  it("resolves transport identity without guessing from an arbitrary local alias", () => {
    const model = { providerID: "custom", id: "my-worker" }
    expect(readBundledModelKnowledge(model)).toBeUndefined()
    expect(readBundledModelKnowledge(model, { transportID: "LongCat-2.5-Preview" })).toMatchObject({ model, known: true })
    expect(readBundledModelKnowledge({ ...model, id: "longcat-2.5-preview-unknown" })).toBeUndefined()
    expect(readBundledModelKnowledge({ ...model, id: "MIMO-V2.6-FLASH-FREE" })).toBeUndefined()
  })

  it("rejects canonical contradictions and ambiguous known aliases", () => {
    const model = { providerID: "custom", id: "mimo-v2.6-flash-free" }
    expect(readBundledModelKnowledge(model, { canonical: "vendor/unknown" })).toBeUndefined()
    expect(readBundledModelKnowledge(model, { canonical: "meituan/longcat-2.5-preview" })).toBeUndefined()
    expect(readBundledModelKnowledge(model, { transportID: "longcat-2.5-preview" })).toBeUndefined()
  })

  it("does not expose mutable references to the bundled registry", () => {
    const model = { providerID: "custom", id: "nemotron-3.5-lightning" }
    const fact = readBundledModelKnowledge(model)
    const strengths = [...fact!.strengths!]
    if (Array.isArray(fact!.strengths)) fact!.strengths.push("untrusted")
    expect(readBundledModelKnowledge(model)?.strengths).toEqual(strengths)
  })

  it("rejects malformed evidence, private provider fields and duplicate identities", () => {
    expect(ModelCardSchema.safeParse(card).success).toBe(true)
    for (const change of [
      { sources: [] }, { sources: ["file:///private"] }, { sources: ["https://secret@vendor.test/"] },
      { sources: ["https://vendor.test/?API_KEY=secret"] }, { researchedAt: "yesterday" }, { aliases: ["model", "model"] }, { aliases: ["vendor/model"] },
      { price: { input: 0 } }, { endpoint: "https://provider.test" }, { canonical: " vendor/model" },
    ]) expect(ModelCardSchema.safeParse({ ...card, ...change }).success).toBe(false)
    expect(ModelCatalogSchema.safeParse({ version: 1, models: [card, { ...card, canonical: "other", aliases: ["model"] }] }).success).toBe(false)
    expect(ModelCatalogSchema.safeParse({ version: 1, models: [card, { ...card, canonical: "model", aliases: [] }] }).success).toBe(false)
  })
})


it("does not equate a fixed Flash-RL checkpoint with the updated hosted Flash API identity", () => {
  expect(readBundledModelKnowledge({ providerID: "weights", id: "XiaomiMiMo/MiMo-V2.6-Flash-RL" })).toBeUndefined()
  expect(readBundledModelKnowledge({ providerID: "opencode", id: "mimo-v2.6-flash-free" })?.known).toBe(true)
})
