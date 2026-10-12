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
      researchedAt: "2026-10-12T00:00:00.000Z",
    })

    expect(store.read(model)).toMatchObject({
      model,
      known: true,
      source: "https://provider.example/model-card",
      summary: "Research profile",
    })
    expect(JSON.parse(readFileSync(path, "utf8"))).toMatchObject({ version: 1 })
  })

  test("rejects source-less claims", () => {
    const root = mkdtempSync(join(tmpdir(), "momo-native-knowledge-empty-"))
    roots.push(root)
    const store = createNativeCatalogKnowledgeStore(join(root, "knowledge.json"))

    expect(() => store.upsert({
      providerID: "fake", id: "model", summary: "unsupported claim", sources: [], researchedAt: "2026-10-12T00:00:00.000Z",
    })).toThrow("at least one non-empty source")
  })
})
