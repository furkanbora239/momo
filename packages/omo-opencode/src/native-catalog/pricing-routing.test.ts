import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { NativeJevRequest } from "../native-routing/types"
import { createNativeJevBackend } from "../native-routing/jev-adapter"
import type { NativeCatalogContext } from "./types"
import { createNativeCatalogAdapter } from "./adapter"
import { createNativeCatalogKnowledgeStore } from "./knowledge-store"

function model(providerID: string, id: string, input: number, output: number) {
  return {
    providerID, id, modelID: id, name: id, package: "@ai-sdk/openai-compatible",
    capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 1 },
    cost: [{ input, output, cache: { read: 0, write: 0 } }], status: "active", enabled: true,
    limit: { context: 64_000, output: 4096 },
  }
}

describe("source-backed pricing to Jev", () => {
  test("routes a sourced free candidate, keeps priced costs, and does not infer zero from SDK defaults", async () => {
    const home = mkdtempSync(join(tmpdir(), "momo-native-price-routing-"))
    try {
      const source = "https://provider.example/docs/free-model-pricing"
      const store = createNativeCatalogKnowledgeStore(join(home, ".omo/native/catalog-knowledge.json"))
      store.upsert({
        providerID: "fake", id: "free-alias", sources: [source],
        price: { currency: "USD", inputPerMillion: 0, outputPerMillion: 0, source },
        researchedAt: "2026-10-12T00:00:00.000Z",
      })
      const context = {
        provider: { list: async () => ({ location: { directory: home }, data: [
          { id: "fake", name: "fake", activation: "enabled", package: "@ai-sdk/openai-compatible", settings: {} },
        ] }) },
        model: { list: async () => ({ location: { directory: home }, data: [
          model("fake", "free-alias", 0, 0), model("fake", "paid-alias", 0.1, 0.3), model("fake", "unknown-zero", 0, 0),
        ] }) },
        integration: { connection: { active: async () => undefined, resolve: async () => undefined } },
      } as unknown as NativeCatalogContext
      const adapter = createNativeCatalogAdapter({
        context, homeDirectory: home, knowledgeStore: store,
        readPool: () => ({ version: 1, allowed: [], updatedAt: "test" }),
        readToggles: () => ({ version: 1, disabled: [], updatedAt: "test" }),
        readHealth: () => ({}),
      })
      const facts = await adapter.catalog.listAvailable()
      const byID = new Map(facts.map((fact) => [fact.id, fact]))
      expect(byID.get("free-alias")).toMatchObject({ inputPricePerMillion: 0, outputPricePerMillion: 0, priceCurrency: "USD", priceOrigin: source })
      expect(byID.get("paid-alias")).toMatchObject({ inputPricePerMillion: 0.1, outputPricePerMillion: 0.3, priceCurrency: "USD" })
      expect(byID.get("unknown-zero")).toMatchObject({ priceSource: "unknown", priceCurrency: "unknown" })

      let transmitted: Record<string, string> = {}
      const jev = createNativeJevBackend({
        getApiKey: () => "fixture-key",
        postJson: async (_url, _headers, body) => {
          const request = body as { questions: { candidate: { criteria: Record<string, string> } } }
          transmitted = request.questions.candidate.criteria
          const freeKey = "worker|fake/free-alias"
          return { status: 200, body: { model: "local-fixture", answers: {
            candidate: { type: "choice", choice: freeKey, confidence: 0.99, probabilities: { [freeKey]: 1 } },
            lane: { type: "choice", choice: "direct", confidence: 0.99, probabilities: { direct: 1 } },
          }, usage: { input_tokens: 10, output_tokens: 2 } } }
        },
      })
      const modelRefs = facts.map(({ providerID, id }) => ({ providerID, id }))
      const candidates: NativeJevRequest["candidates"] = facts.map((fact, index) => ({
        role: "worker", model: modelRefs[index]!, facts: fact,
        knowledge: { model: modelRefs[index]!, known: false },
      }))
      const selected = await jev.choose({
        decisionId: "isolated-price-proof",
        input: { prompt: "local fixture", parentRole: "orchestrator", rootSessionID: "fixture-root", parentSessionID: "fixture-root", kind: "task" },
        allowedRoles: ["worker"], candidates, knowledge: [], outcomes: [], instructions: "local price selection fixture",
      })

      expect(selected.model).toMatchObject({ providerID: "fake", id: "free-alias" })
      expect(JSON.parse(transmitted["worker|fake/free-alias"]!).pricesPerMillion).toEqual({ input: 0, output: 0 })
      expect(JSON.parse(transmitted["worker|fake/free-alias"]!).priceCurrency).toBe("USD")
      expect(JSON.parse(transmitted["worker|fake/free-alias"]!).priceOrigin).toBe(source)
      expect(JSON.parse(transmitted["worker|fake/paid-alias"]!).pricesPerMillion).toEqual({ input: 0.1, output: 0.3 })
      expect(JSON.parse(transmitted["worker|fake/unknown-zero"]!).pricesPerMillion).toEqual({ input: "unknown", output: "unknown" })
      expect(store.readPrice({ providerID: "fake", id: "free-alias" })?.source).toBe(source)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
