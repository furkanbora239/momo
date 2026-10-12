import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { NativeCatalogContext } from "./types"
import { createNativeCatalogAdapter } from "./adapter"

const pool = { version: 1 as const, allowed: [], updatedAt: "test" }

function contextFixture(input: { providers: unknown[]; models: unknown[] }): NativeCatalogContext {
  const fixture = {
    provider: { list: async () => ({ location: { directory: "/fixture" }, data: input.providers }) },
    model: { list: async () => ({ location: { directory: "/fixture" }, data: input.models }) },
    integration: {
      connection: {
        active: async (integrationID: string) => integrationID === "connected" ? { type: "credential", id: "credential-1", label: "fixture key", method: "key" } : undefined,
        resolve: async () => ({ type: "key", key: "fixture-secret" }),
      },
    },
  }
  return fixture as unknown as NativeCatalogContext
}

function provider(id: string, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, name: id, activation: "enabled", package: "@ai-sdk/openai-compatible", integrationID: "connected", settings: { baseURL: "https://provider.test/v1" }, ...extras }
}

function model(providerID: string, id: string, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id, modelID: id, providerID, name: id, package: "@ai-sdk/openai-compatible",
    capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 1 },
    cost: [{ input: 0.2, output: 1.1, cache: { read: 0, write: 0 } }], status: "active", enabled: true,
    limit: { context: 32000, output: 4096 }, ...extras,
  }
}

describe("native catalog adapter", () => {
  it("uses actual V2 provider/model records and resolved integration credentials for live reconciliation", async () => {
    const adapter = createNativeCatalogAdapter({
      context: contextFixture({
        providers: [provider("live"), provider("offline", { integrationID: "missing" })],
        models: [model("live", "native-alias", { modelID: "transport-name" }), model("offline", "hidden")],
      }),
      readPool: () => pool,
      readToggles: () => ({ version: 1, disabled: [], updatedAt: "test" }),
      readHealth: () => ({}),
      fetchImpl: async (input, init) => {
        expect(String(input)).toBe("https://provider.test/v1/models")
        expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fixture-secret")
        return new Response(JSON.stringify({ data: [{ id: "transport-name", context_length: 64000 }, { id: "live-only" }] }), { status: 200 })
      },
    })

    await adapter.refresh()
    const models = await adapter.catalog.listAvailable()
    expect(models.map((item) => `${item.providerID}/${item.id}`)).toEqual(["live/native-alias"])
    expect(models[0]).toMatchObject({ inputPricePerMillion: 0.2, outputPricePerMillion: 1.1, contextLength: 64000, toolCall: true })
    expect(adapter.snapshot().sources["live/native-alias"]).toEqual(["opencode.provider.list", "opencode.model.list", "provider.GET /models"])
    expect(adapter.snapshot().transportModelIDs["live/native-alias"]).toBe("transport-name")
    expect(adapter.snapshot().unregisteredLiveModels.live).toEqual(["live-only"])
    expect(await adapter.knowledge.get({ providerID: "live", id: "native-alias" })).toEqual({ model: { providerID: "live", id: "native-alias" }, known: false })
    expect(adapter.snapshot().unavailableProviders.offline).toEqual({ reason: "no active OpenCode integration connection" })
  })

  it("evicts inactive and health-blocked providers, preserves unknown prices, and gates consultation pool", async () => {
    const adapter = createNativeCatalogAdapter({
      context: contextFixture({
        providers: [provider("disabled", { activation: "disabled" }), provider("limited", { settings: {} }), provider("ok", { settings: {} })],
        models: [model("disabled", "x"), model("limited", "y"), model("ok", "z", { cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }], capabilities: { tools: false, input: ["text"], output: ["text"] } })],
      }),
      readPool: () => ({ ...pool, allowed: [{ providerID: "ok", modelID: "z" }] }),
      readToggles: () => ({ version: 1, disabled: [], updatedAt: "test" }),
      readHealth: () => ({ limited: { reason: "quota_exceeded", unavailableUntil: 9_999_999_999_999 } }),
      advisorModels: [{ providerID: "ok", id: "z" }],
    })
    await adapter.refresh()
    expect((await adapter.catalog.listAvailable()).map((item) => item.providerID)).toEqual(["ok"])
    expect((await adapter.catalog.listAvailable())[0]?.inputPricePerMillion).toBeUndefined()
    expect((await adapter.catalog.listAvailable())[0]?.priceSource).toBe("unknown")
    expect((await adapter.catalog.listAvailable())[0]?.toolCall).toBe(false)
    expect(adapter.snapshot().unavailableProviders).toEqual({
      disabled: { reason: "disabled in OpenCode provider settings" },
      limited: { reason: "quota_exceeded", until: 9_999_999_999_999 },
    })
    expect(await adapter.pool.isAllowed({ providerID: "ok", id: "z" })).toBe(true)
    expect(await adapter.pool.isAllowed({ providerID: "ok", id: "other" })).toBe(false)
    expect(await adapter.pool.isConsultationAllowed?.({ providerID: "ok", id: "z" })).toBe(true)
    adapter.setAdvisorModels([])
    expect(await adapter.pool.isConsultationAllowed?.({ providerID: "ok", id: "z" })).toBe(false)
  })

  it("preserves a free price only when the provider supplies verified price provenance", async () => {
    const adapter = createNativeCatalogAdapter({
      context: contextFixture({ providers: [provider("free", { settings: {} })], models: [model("free", "zero", {
        cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
      })] }),
      readPool: () => pool,
      readToggles: () => ({ version: 1, disabled: [], updatedAt: "test" }),
      readHealth: () => ({}),
      priceProvenance: () => "configuration",
    })
    await adapter.refresh()
    expect(await adapter.catalog.listAvailable()).toMatchObject([{ inputPricePerMillion: 0, outputPricePerMillion: 0, priceSource: "configuration" }])
  })

  it("does not mark source-less knowledge as verified", async () => {
    const adapter = createNativeCatalogAdapter({
      context: contextFixture({ providers: [provider("local", { package: "native/local", settings: {} })], models: [model("local", "model")] }),
      readPool: () => pool,
      readToggles: () => ({ version: 1, disabled: [], updatedAt: "test" }),
      readHealth: () => ({}),
      readKnowledge: (modelRef) => ({ model: modelRef, known: true, summary: "assistant-originated unverified statement", source: "   " }),
    })

    expect(await adapter.knowledge.get({ providerID: "local", id: "model" })).toMatchObject({ known: false })
  })

  it("keeps native health and knowledge writes under the injected home root", async () => {
    const home = mkdtempSync(join(tmpdir(), "momo-native-catalog-home-"))
    try {
      const errors: string[] = []
      const adapter = createNativeCatalogAdapter({
        homeDirectory: home,
        context: contextFixture({ providers: [provider("bad")], models: [model("bad", "model")] }),
        fetchImpl: async () => new Response("unavailable", { status: 503 }),
        onError: (message) => errors.push(message),
      })
      await adapter.refresh()
      const healthPath = join(home, ".omo", "native-cache", "provider-health.json")
      expect(existsSync(healthPath)).toBe(true)
      expect(JSON.parse(readFileSync(healthPath, "utf8"))).toHaveProperty("bad")
      expect(errors.some((message) => message.includes("provider bad"))).toBe(true)

      adapter.knowledgeStore.upsert({
        providerID: "bad", id: "model", sources: ["https://provider.example/model"], researchedAt: "2026-10-12T00:00:00.000Z",
      })
      expect(await adapter.knowledge.get({ providerID: "bad", id: "model" })).toMatchObject({ known: true })
      expect(existsSync(join(home, ".omo", "native", "catalog-knowledge.json"))).toBe(true)
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
