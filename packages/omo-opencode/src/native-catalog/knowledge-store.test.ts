import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNativeCatalogKnowledgeStore } from "./knowledge-store"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("native catalog knowledge store", () => {
  test("persists only source-backed research beneath its injected data root", () => {
    const root = mkdtempSync(join(tmpdir(), "momo-native-knowledge-"))
    roots.push(root)
    const path = join(root, ".omo", "native", "catalog-knowledge.json")
    const store = createNativeCatalogKnowledgeStore(path)
    const model = { providerID: "fake", id: "model-alias" }

    store.upsert({
      ...model,
      summary: "Research profile",
      strengths: ["small coding tasks"],
      limitations: ["short context"],
      sources: ["https://provider.example/model-card"],
      price: { currency: "USD", inputPerMillion: 0, outputPerMillion: 0, source: "https://provider.example/model-card" },
      researchedAt: "2026-10-12T00:00:00.000Z",
    })

    expect(store.read(model)).toMatchObject({
      model,
      known: true,
      source: "https://provider.example/model-card",
      summary: "Research profile",
    })
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ version: 1 })
    expect(store.readPrice(model)).toEqual({ currency: "USD", inputPerMillion: 0, outputPerMillion: 0, source: "https://provider.example/model-card" })
    expect(store.readEntry(model)).toMatchObject({ ...model, sources: ["https://provider.example/model-card"], researchedAt: "2026-10-12T00:00:00.000Z" })
    expect(store.readEntry({ providerID: "absent", id: "model" })).toBeUndefined()
  })

  test("rejects source-less claims", () => {
    const root = mkdtempSync(join(tmpdir(), "momo-native-knowledge-empty-"))
    roots.push(root)
    const store = createNativeCatalogKnowledgeStore(join(root, "knowledge.json"))

    expect(() => store.upsert({
      providerID: "fake", id: "model", summary: "unsupported claim", sources: [], researchedAt: "2026-10-12T00:00:00.000Z",
    })).toThrow("at least one non-empty source")
  })

  test("rejects invalid or uncited published price claims", () => {
    const root = mkdtempSync(join(tmpdir(), "momo-native-knowledge-price-"))
    roots.push(root)
    const store = createNativeCatalogKnowledgeStore(join(root, "knowledge.json"))
    const base = { providerID: "fake", id: "model", sources: ["https://provider.example/docs"], researchedAt: "2026-10-12T00:00:00.000Z" }

    expect(() => store.upsert({ ...base, price: { currency: "USD", inputPerMillion: -1, outputPerMillion: 0, source: base.sources[0]! } })).toThrow()
    expect(() => store.upsert({ ...base, price: { currency: "USD", inputPerMillion: 0, outputPerMillion: 0, source: "https://other.example/docs" } })).toThrow("cite a source URL")
  })
})
