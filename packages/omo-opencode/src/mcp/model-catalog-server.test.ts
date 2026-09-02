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

function stateWith(
  file: string,
  prefer: Record<string, string[]> = {},
  preferProviders: string[] = [],
): CatalogState {
  return { cacheFile: file, prefer, preferProviders }
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

  it("refreshes from the cache file", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", { name: "catalog_refresh" })
    const result = parseToolPayload(response)
    expect(result.refreshed).toBe(true)
    expect(result.modelCount).toBe(5)
  })

  it("advertises three tools", async () => {
    const response = await call(stateWith(makeCache(SAMPLE)), "tools/list")
    const tools = (response as { result?: { tools?: Array<{ name: string }> } }).result?.tools?.map((tool) => tool.name)
    expect(tools).toEqual(["catalog_list", "catalog_pick", "catalog_refresh"])
  })
})
