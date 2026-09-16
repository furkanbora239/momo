import { describe, expect, it } from "bun:test"
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  handleCatalogRequest,
  type CatalogState,
} from "./model-catalog-server"

// Samples mirror the REAL provider-models cache shape written by
// connected-providers-cache.ts: nested capabilities boolean maps, limit.* and cost.*.
interface ModelOverrides {
  id: string
  name: string
  providerID?: string
  reasoning?: boolean
  toolcall?: boolean
  image?: boolean
  context?: number
  outputLimit?: number
  costInput?: number
  costOutput?: number
  outputText?: boolean
  family?: string
  releaseDate?: string
}

function model(overrides: ModelOverrides): Record<string, unknown> {
  return {
    id: overrides.id,
    providerID: overrides.providerID ?? "sample",
    api: { id: overrides.id, url: "", npm: "@ai-sdk/test" },
    name: overrides.name,
    family: overrides.family ?? null,
    capabilities: {
      temperature: true,
      reasoning: overrides.reasoning ?? false,
      attachment: false,
      toolcall: overrides.toolcall ?? false,
      interleaved: false,
      input: { text: true, audio: false, image: overrides.image ?? false, video: false, pdf: false },
      output: { text: overrides.outputText ?? true, audio: !overrides.outputText ? true : false, image: false, video: false, pdf: false },
    },
    cost: {
      input: overrides.costInput ?? 0.5,
      output: overrides.costOutput ?? 1.5,
      cache: { read: 0, write: 0 },
    },
    limit: { context: overrides.context ?? 128000, output: overrides.outputLimit ?? 16000 },
    status: "active",
    options: {},
    headers: {},
    release_date: overrides.releaseDate ?? null,
    variants: {},
  }
}

function makeCache(models: Record<string, Record<string, unknown>[]>): string {
  const dir = mkdtempSync(join(tmpdir(), "catalog-test-"))
  const file = join(dir, "provider-models.json")
  writeFileSync(file, JSON.stringify({ models, connected: Object.keys(models), updatedAt: "2026-09-02T00:00:00Z" }))
  return file
}

function makeHealthFile(entries: Record<string, { reason: string; statusCode?: number; unavailableUntil: number }>): string {
  const dir = mkdtempSync(join(tmpdir(), "catalog-health-"))
  const file = join(dir, "provider-health.json")
  writeFileSync(file, JSON.stringify(entries))
  return file
}

function makePoolFile(entries: Array<{ providerID: string; modelID: string; preferred?: boolean }>): string {
  const dir = mkdtempSync(join(tmpdir(), "catalog-pool-"))
  const file = join(dir, "model-pool.json")
  writeFileSync(
    file,
    JSON.stringify({ version: 1, allowed: entries, updatedAt: "2026-09-02T00:00:00Z" }),
  )
  return file
}

function makeTogglesFile(disabled: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "catalog-toggles-"))
  const file = join(dir, "provider-toggles.json")
  writeFileSync(
    file,
    JSON.stringify({ version: 1, disabled, updatedAt: "2026-09-02T00:00:00Z" }),
  )
  return file
}

function stateWith(
  file: string,
  prefer: Record<string, string[]> = {},
  preferProviders: string[] = [],
  disabledProviders: string[] = [],
  healthFile?: string,
  poolFile?: string,
  togglesFile?: string,
): CatalogState {
  return { cacheFile: file, prefer, preferProviders, disabledProviders, healthFile, poolFile, togglesFile }
}

const SAMPLE = {
  openai: [
    model({ id: "gpt-flash", name: "GPT Flash", providerID: "openai", toolcall: true, costInput: 0.15, costOutput: 0.6, context: 128000 }),
    model({ id: "gpt-pro", name: "GPT Pro", providerID: "openai", reasoning: true, toolcall: true, costInput: 2, costOutput: 10, context: 200000 }),
  ],
  google: [
    model({ id: "gemini-flash", name: "Gemini Flash", providerID: "google", image: true, toolcall: true, costInput: 0.1, costOutput: 0.4, context: 1000000 }),
    model({ id: "veo-clone-preview", name: "Veo Clone Preview", providerID: "google", outputText: false, costInput: 0, costOutput: 0 }),
    model({ id: "gemini-embedding-clone", name: "Gemini Embedding Clone", providerID: "google", costInput: 0.15, costOutput: 0 }),
  ],
}

const MIXED_TIERS = {
  openai: [
    model({ id: "gpt-flash", name: "GPT Flash", providerID: "openai", toolcall: true, costInput: 0.1, costOutput: 0.4 }),
  ],
  neuralwatt: [
    model({ id: "glm-5.2", name: "GLM 5.2 Pro", providerID: "neuralwatt", reasoning: true, toolcall: true, costInput: 0.95, costOutput: 4 }),
    model({ id: "kimi-flash", name: "Kimi Flash", providerID: "neuralwatt", toolcall: true, costInput: 0.1, costOutput: 0.4 }),
  ],
}

const GLM_PAIR = {
  neuralwatt: [
    model({ id: "glm-5.2", name: "GLM 5.2", providerID: "neuralwatt", reasoning: true, toolcall: true, costInput: 0.95, costOutput: 4 }),
  ],
  "opencode-go": [
    model({ id: "glm-5.3-flash", name: "GLM 5.3 Flash", providerID: "opencode-go", reasoning: true, toolcall: true, costInput: 0.1, costOutput: 0.4 }),
  ],
}

const GLM_WITHOUT_SUCCESSOR = {
  openai: [
    model({ id: "gpt-flash", name: "GPT Flash", providerID: "openai", toolcall: true, costInput: 0.15, costOutput: 0.6 }),
  ],
  neuralwatt: [
    model({ id: "glm-5.2", name: "GLM 5.2", providerID: "neuralwatt", reasoning: true, toolcall: true, costInput: 0.95, costOutput: 4 }),
  ],
}

const SWE_TIE = {
  openai: [
    model({ id: "model-alpha", name: "Model Alpha", providerID: "openai", reasoning: true, toolcall: true, costInput: 1, costOutput: 3 }),
  ],
  neuralwatt: [
    model({ id: "kimi-k3", name: "Kimi K3", providerID: "neuralwatt", reasoning: true, toolcall: true, costInput: 1, costOutput: 3 }),
  ],
}

function call(state: CatalogState, method: string, params?: unknown) {
  return handleCatalogRequest({ jsonrpc: "2.0", id: 1, method, params }, state)
}

function parseToolPayload(response: unknown): Record<string, unknown> {
  const shaped = response as { result?: { content?: Array<{ text?: string }> } }
  const text = shaped.result?.content?.[0]?.text
  return JSON.parse(text ?? "{}") as Record<string, unknown>
}

describe("catalog MCP", () => {
  it("lists and filters models by capability read from nested capabilities maps", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", { name: "catalog_list", arguments: { capability: "vision" } })
    const result = parseToolPayload(response)
    expect(result.count).toBe(1)
    const models = result.models as Array<Record<string, unknown>>
    expect(models[0].id).toBe("gemini-flash")
    expect(models[0].vision).toBe(true)
  })

  it("filters by provider and tier", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", { name: "catalog_list", arguments: { provider: "openai", tier: "pro" } })
    const result = parseToolPayload(response)
    expect(result.count).toBe(1)
    const models = result.models as Array<Record<string, unknown>>
    expect(models[0].id).toBe("gpt-pro")
  })

  it("exposes pricing, cost_tier, context_window and release_date from the real cache shape", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", { name: "catalog_list", arguments: { provider: "openai" } })
    const result = parseToolPayload(response)
    const models = result.models as Array<Record<string, unknown>>
    const flash = models.find((entry) => entry.id === "gpt-flash") as Record<string, unknown>
    expect(flash.pricing).toEqual({ input_per_m: 0.15, output_per_m: 0.6, currency: "USD" })
    expect(flash.cost_tier).toBe("budget")
    expect(flash.context_window).toBe(128000)
    expect(Array.isArray(flash.strengths)).toBe(true)
    expect(Array.isArray(flash.weaknesses)).toBe(true)
    const pro = models.find((entry) => entry.id === "gpt-pro") as Record<string, unknown>
    expect(pro.cost_tier).toBe("balanced")
    expect(pro.strengths).toContain("complex_reasoning")
  })

  it("filters by cost_tier", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", { name: "catalog_list", arguments: { cost_tier: "budget" } })
    const result = parseToolPayload(response)
    const models = result.models as Array<Record<string, unknown>>
    expect(models.map((entry) => entry.id).sort()).toEqual(["gemini-embedding-clone", "gemini-flash", "gpt-flash", "veo-clone-preview"])
  })

  it("picks vision models for a vision need", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "vision" } })
    const result = parseToolPayload(response)
    const picks = result.picks as Array<Record<string, unknown>>
    expect(picks.length).toBeGreaterThan(0)
    expect(picks[0].id).toBe("gemini-flash")
  })

  it("includes cost metadata in picks", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "default" } })
    const result = parseToolPayload(response)
    const picks = result.picks as Array<Record<string, unknown>>
    expect(picks[0].cost_tier).toBe("budget")
    expect(picks[0].pricing).toEqual({ input_per_m: 0.1, output_per_m: 0.4, currency: "USD" })
  })

  it("low_cost budget profile ranks the cheapest blended price first", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", {
      name: "catalog_pick",
      arguments: { need: "default", budget_profile: "low_cost", task_complexity: "moderate" },
    })
    const result = parseToolPayload(response)
    const picks = result.picks as Array<{ id: string; cost_tier: string }>
    expect(picks[0].id).toBe("gemini-flash")
    expect(picks[picks.length - 1].id).toBe("gpt-pro")
  })

  it("max_performance budget profile ranks reasoning-capable models first", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", {
      name: "catalog_pick",
      arguments: { need: "default", budget_profile: "max_performance" },
    })
    const result = parseToolPayload(response)
    const picks = result.picks as Array<{ id: string }>
    expect(picks[0].id).toBe("gpt-pro")
  })

  it("task_complexity complex restricts to reasoning-capable models only", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", {
      name: "catalog_pick",
      arguments: { need: "default", task_complexity: "complex" },
    })
    const result = parseToolPayload(response)
    const picks = result.picks as Array<{ id: string }>
    expect(picks.map((pick) => pick.id)).toEqual(["gpt-pro"])
  })

  it("task_complexity trivial keeps the cheapest tier first", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", {
      name: "catalog_pick",
      arguments: { need: "default", task_complexity: "trivial" },
    })
    const result = parseToolPayload(response)
    const picks = result.picks as Array<{ id: string }>
    expect(picks[0].id).toBe("gemini-flash")
  })

  it("excludes text-incapable media models from non-media picks", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", {
      name: "catalog_pick",
      arguments: { need: "default", budget_profile: "low_cost" },
    })
    const result = parseToolPayload(response)
    const pickIds = (result.picks as Array<{ id: string }>).map((pick) => pick.id)
    expect(pickIds).not.toContain("veo-clone-preview")
    expect(pickIds).not.toContain("gemini-embedding-clone")
    expect(pickIds).toContain("gemini-flash")
  })

  it("keeps media-incapable-of-text models eligible for explicit media needs", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", {
      name: "catalog_pick",
      arguments: { need: "video generation" },
    })
    const result = parseToolPayload(response)
    const pickIds = (result.picks as Array<{ id: string }>).map((pick) => pick.id)
    expect(pickIds).toContain("veo-clone-preview")
  })

  it("exposes text_output in catalog_list rows", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", { name: "catalog_list", arguments: { provider: "google" } })
    const result = parseToolPayload(response)
    const models = result.models as Array<Record<string, unknown>>
    const veo = models.find((entry) => entry.id === "veo-clone-preview") as Record<string, unknown>
    expect(veo.text_output).toBe(false)
    const flash = models.find((entry) => entry.id === "gemini-flash") as Record<string, unknown>
    expect(flash.text_output).toBe(true)
  })

  it("honors prefer boosts", async () => {
    const state = stateWith(makeCache(SAMPLE), { campaign: ["gpt-pro"] })
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "campaign" } })
    const result = parseToolPayload(response)
    const picks = result.picks as Array<{ id: string }>
    expect(picks[0].id).toBe("gpt-pro")
  })

  it("boosts preferred providers ahead within the same tier", async () => {
    const state = stateWith(makeCache(MIXED_TIERS), {}, ["neuralwatt"])
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "fast" } })
    const result = parseToolPayload(response)
    const picks = result.picks as Array<{ id: string }>
    expect(picks[0].id).toBe("kimi-flash")
    expect(picks[1].id).toBe("gpt-flash")
  })

  it("keeps the provider boost inside the tier bucket", async () => {
    const state = stateWith(makeCache(MIXED_TIERS), {}, ["neuralwatt"])
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "fast" } })
    const result = parseToolPayload(response)
    const pickIds = (result.picks as Array<{ id: string }>).map((pick) => pick.id)
    expect(pickIds.indexOf("glm-5.2")).toBeGreaterThan(pickIds.indexOf("gpt-flash"))
  })

  it("stays neutral when the prefer_providers list is empty", async () => {
    const state = stateWith(makeCache(MIXED_TIERS))
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "fast" } })
    const result = parseToolPayload(response)
    const picks = result.picks as Array<{ id: string }>
    expect(picks[0].id).toBe("gpt-flash")
  })

  it("applies the provider boost after an explicit prefer hint", async () => {
    const cache = makeCache(MIXED_TIERS)
    const state = stateWith(cache, { campaign: ["gpt-flash"] }, ["neuralwatt"])
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "campaign" } })
    const result = parseToolPayload(response)
    const picks = result.picks as Array<{ id: string }>
    expect(picks[0].id).toBe("gpt-flash")
    expect(picks[1].id).toBe("kimi-flash")
  })

  it("ranks glm-5.3-flash above superseded glm-5.2 when both are connected", async () => {
    const state = stateWith(makeCache(GLM_PAIR))
    const response = await call(state, "tools/call", {
      name: "catalog_pick",
      arguments: { need: "code", budget_profile: "balanced" },
    })
    const result = parseToolPayload(response)
    const picks = result.picks as Array<{ id: string; weaknesses: string[] }>
    expect(picks[0].id).toBe("glm-5.3-flash")
    expect(picks[1].id).toBe("glm-5.2")
    expect(Array.isArray(picks[0].weaknesses)).toBe(true)
    expect(picks[0].weaknesses.length).toBeGreaterThan(0)
  })

  it("keeps glm-5.3-flash first for complex tasks despite the neuralwatt provider preference", async () => {
    const state = stateWith(makeCache(GLM_PAIR))
    const response = await call(state, "tools/call", {
      name: "catalog_pick",
      arguments: { need: "code", budget_profile: "balanced", task_complexity: "complex" },
    })
    const result = parseToolPayload(response)
    const picks = result.picks as Array<{ id: string }>
    expect(picks[0].id).toBe("glm-5.3-flash")
    expect(picks[1].id).toBe("glm-5.2")
  })

  it("does not demote glm-5.2 when glm-5.3-flash is absent from the cache", async () => {
    const state = stateWith(makeCache(GLM_WITHOUT_SUCCESSOR))
    const response = await call(state, "tools/call", {
      name: "catalog_pick",
      arguments: { need: "code", task_complexity: "complex" },
    })
    const result = parseToolPayload(response)
    const picks = result.picks as Array<{ id: string }>
    expect(picks[0].id).toBe("glm-5.2")
  })

  it("breaks balanced price ties with the knowledge-base sweBench estimate", async () => {
    const state = stateWith(makeCache(SWE_TIE))
    const response = await call(state, "tools/call", {
      name: "catalog_pick",
      arguments: { need: "default", budget_profile: "balanced" },
    })
    const result = parseToolPayload(response)
    const picks = result.picks as Array<{ id: string }>
    expect(picks[0].id).toBe("kimi-k3")
    expect(picks[1].id).toBe("model-alpha")
  })

  it("refreshes from the cache file", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", { name: "catalog_refresh" })
    const result = parseToolPayload(response)
    expect(result.refreshed).toBe(true)
    expect(result.modelCount).toBe(5)
  })

  it("advertises the catalog and knowledge tools", async () => {
    const response = await call(stateWith(makeCache(SAMPLE)), "tools/list")
    const tools = (response as { result?: { tools?: Array<{ name: string }> } }).result?.tools?.map((tool) => tool.name)
    expect(tools).toEqual(["catalog_list", "catalog_pick", "catalog_refresh", "catalog_knowledge", "catalog_enrich"])
  })

  it("drops rows from disabled providers in catalog_list", async () => {
    const state = stateWith(makeCache(MIXED_TIERS), {}, [], ["neuralwatt"])
    const response = await call(state, "tools/call", { name: "catalog_list" })
    const result = parseToolPayload(response)
    const models = result.models as Array<Record<string, unknown>>
    const providers = new Set(models.map((entry) => entry.provider))
    expect(providers.has("neuralwatt")).toBe(false)
    expect(providers.has("openai")).toBe(true)
  })

  it("excludes disabled providers from catalog_pick ranking", async () => {
    const state = stateWith(makeCache(MIXED_TIERS), {}, [], ["neuralwatt"])
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "fast" } })
    const result = parseToolPayload(response)
    const picks = result.picks as Array<Record<string, unknown>>
    expect(picks.map((pick) => pick.provider)).not.toContain("neuralwatt")
    expect(picks[0].provider).toBe("openai")
  })

  it("lists an unavailable provider with healthy:false but excludes it from pick", async () => {
    const health = makeHealthFile({
      neuralwatt: { reason: "quota_exceeded", unavailableUntil: Date.now() + 60_000 },
    })
    const state = stateWith(makeCache(MIXED_TIERS), {}, [], [], health)

    const listResponse = await call(state, "tools/call", { name: "catalog_list" })
    const listResult = parseToolPayload(listResponse)
    const models = listResult.models as Array<Record<string, unknown>>
    const kimi = models.find((entry) => entry.id === "kimi-flash") as Record<string, unknown>
    expect(kimi.healthy).toBe(false)
    expect(kimi.provider).toBe("neuralwatt")

    const pickResponse = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "fast" } })
    const pickResult = parseToolPayload(pickResponse)
    const picks = pickResult.picks as Array<Record<string, unknown>>
    expect(picks.map((pick) => pick.provider)).not.toContain("neuralwatt")
    expect(picks[0].provider).toBe("openai")
  })

  it("marks a healthy provider healthy:true in catalog_list rows", async () => {
    const state = stateWith(makeCache(MIXED_TIERS))
    const response = await call(state, "tools/call", { name: "catalog_list" })
    const result = parseToolPayload(response)
    const models = result.models as Array<Record<string, unknown>>
    for (const entry of models) {
      expect(entry.healthy).toBe(true)
    }
  })

  it("includes the provider id in every catalog_list row", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", { name: "catalog_list" })
    const result = parseToolPayload(response)
    const models = result.models as Array<Record<string, unknown>>
    expect(models.length).toBeGreaterThan(0)
    for (const entry of models) {
      expect(typeof entry.provider).toBe("string")
      expect((entry.provider as string).length).toBeGreaterThan(0)
    }
  })

  it("never returns a model outside the pool from catalog_pick", async () => {
    // given: a pool file allowing exactly one model
    const poolFile = makePoolFile([{ providerID: "openai", modelID: "gpt-flash" }])
    const state = stateWith(makeCache(SAMPLE), {}, [], [], undefined, poolFile)

    // when
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "default" } })

    // then
    const picks = parseToolPayload(response).picks as Array<{ id: string; provider: string }>
    expect(picks.length).toBeGreaterThan(0)
    for (const pick of picks) {
      expect(pick.provider).toBe("openai")
      expect(pick.id).toBe("gpt-flash")
    }
  })

  it("marks allowed rows and excludes non-pool rows in catalog_list", async () => {
    // given: a pool allowing only google/gemini-flash
    const poolFile = makePoolFile([{ providerID: "google", modelID: "gemini-flash" }])
    const state = stateWith(makeCache(SAMPLE), {}, [], [], undefined, poolFile)

    // when
    const response = await call(state, "tools/call", { name: "catalog_list" })

    // then
    const models = parseToolPayload(response).models as Array<Record<string, unknown>>
    expect(models.map((entry) => entry.id)).toEqual(["gemini-flash"])
    expect(models[0].allowed).toBe(true)
    expect(models[0].preferred).toBe(false)
  })

  it("allows all models when the pool file is absent", async () => {
    // given: a poolFile pointing at a path that does not exist
    const missingPoolFile = join(mkdtempSync(join(tmpdir(), "catalog-pool-")), "model-pool.json")
    const state = stateWith(makeCache(SAMPLE), {}, [], [], undefined, missingPoolFile)

    // when
    const response = await call(state, "tools/call", { name: "catalog_list" })

    // then
    const result = parseToolPayload(response)
    expect(result.count).toBe(5)
  })

  it("allows all models when the pool file is empty", async () => {
    // given: a pool file with an empty allowed list
    const poolFile = makePoolFile([])
    const state = stateWith(makeCache(SAMPLE), {}, [], [], undefined, poolFile)

    // when
    const response = await call(state, "tools/call", { name: "catalog_list" })

    // then
    const result = parseToolPayload(response)
    expect(result.count).toBe(5)
  })

  it("boosts pool-preferred models ahead of non-preferred in catalog_pick", async () => {
    // given: a pool where the more expensive pro model is preferred
    const poolFile = makePoolFile([
      { providerID: "openai", modelID: "gpt-flash" },
      { providerID: "openai", modelID: "gpt-pro", preferred: true },
    ])
    const state = stateWith(makeCache(SAMPLE), {}, [], [], undefined, poolFile)

    // when
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "default" } })

    // then: without the preferred boost the cheaper flash tier would rank first
    const picks = parseToolPayload(response).picks as Array<{ id: string }>
    expect(picks[0].id).toBe("gpt-pro")
  })

  it("drops disabled-provider rows from catalog_list while keeping others", async () => {
    // given: google is user-disabled via the provider toggles file, empty pool allows all
    const togglesFile = makeTogglesFile(["google"])
    const poolFile = makePoolFile([])
    const state = stateWith(makeCache(SAMPLE), {}, [], [], undefined, poolFile, togglesFile)

    // when
    const response = await call(state, "tools/call", { name: "catalog_list" })

    // then: only openai rows remain
    const models = parseToolPayload(response).models as Array<Record<string, unknown>>
    expect(models.map((entry) => entry.id)).toEqual(["gpt-flash", "gpt-pro"])
  })

  it("drops disabled-provider rows from catalog_pick while keeping others", async () => {
    // given: google is user-disabled via the provider toggles file, empty pool allows all
    const togglesFile = makeTogglesFile(["google"])
    const poolFile = makePoolFile([])
    const state = stateWith(makeCache(SAMPLE), {}, [], [], undefined, poolFile, togglesFile)

    // when
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "default" } })

    // then: every pick comes from a non-disabled provider
    const picks = parseToolPayload(response).picks as Array<{ provider: string }>
    expect(picks.length).toBeGreaterThan(0)
    for (const pick of picks) {
      expect(pick.provider).toBe("openai")
    }
  })
})
