import { describe, expect, it } from "bun:test"
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  handleCatalogRequest,
  type CatalogState,
} from "./model-catalog-server"

function makeCache(models: Record<string, unknown[]>): string {
  const dir = mkdtempSync(join(tmpdir(), "catalog-test-"))
  const file = join(dir, "provider-models.json")
  writeFileSync(file, JSON.stringify({ models, connected: Object.keys(models), updatedAt: "2026-08-23T00:00:00Z" }))
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
    { id: "openai/gpt-flash", name: "GPT Flash", context: 128000, output: 16000, reasoning: false, tool_call: true },
    { id: "openai/gpt-pro", name: "GPT Pro", context: 200000, output: 32000, reasoning: true, tool_call: true },
  ],
  google: [
    { id: "google/gemini-flash", name: "Gemini Flash", context: 1000000, modalities: { input: ["image", "text"] }, tool_call: true },
  ],
}

const MIXED_TIERS = {
  openai: [
    { id: "openai/gpt-flash", name: "GPT Flash", tool_call: true },
  ],
  neuralwatt: [
    { id: "neuralwatt/glm-5.2", name: "GLM 5.2 Pro", reasoning: true, tool_call: true },
    { id: "neuralwatt/kimi-flash", name: "Kimi Flash", tool_call: true },
  ],
}

function call(state: CatalogState, method: string, params?: unknown) {
  return handleCatalogRequest({ jsonrpc: "2.0", id: 1, method, params }, state)
}

describe("catalog MCP", () => {
  it("lists and filters models by capability", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", { name: "catalog_list", arguments: { capability: "vision" } })
    const result = JSON.parse((response as any).result.content[0].text)
    expect(result.count).toBe(1)
    expect(result.models[0].id).toBe("google/gemini-flash")
    expect(result.models[0].vision).toBe(true)
  })

  it("filters by provider and tier", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", { name: "catalog_list", arguments: { provider: "openai", tier: "pro" } })
    const result = JSON.parse((response as any).result.content[0].text)
    expect(result.count).toBe(1)
    expect(result.models[0].id).toBe("openai/gpt-pro")
  })

  it("picks vision models for a vision need", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "vision" } })
    const result = JSON.parse((response as any).result.content[0].text)
    expect(result.picks.length).toBeGreaterThan(0)
    expect(result.picks[0].id).toBe("google/gemini-flash")
  })

  it("honors prefer boosts", async () => {
    const state = stateWith(makeCache(SAMPLE), { campaign: ["openai/gpt-pro"] })
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "campaign" } })
    const result = JSON.parse((response as any).result.content[0].text)
    expect(result.picks[0].id).toBe("openai/gpt-pro")
  })

  it("boosts preferred providers ahead within the same tier", async () => {
    const state = stateWith(makeCache(MIXED_TIERS), {}, ["neuralwatt"])
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "fast" } })
    const result = JSON.parse((response as any).result.content[0].text)
    expect(result.picks[0].id).toBe("neuralwatt/kimi-flash")
    expect(result.picks[1].id).toBe("openai/gpt-flash")
  })

  it("keeps the provider boost inside the tier bucket", async () => {
    const state = stateWith(makeCache(MIXED_TIERS), {}, ["neuralwatt"])
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "fast" } })
    const result = JSON.parse((response as any).result.content[0].text)
    const pickIds = result.picks.map((pick: { id: string }) => pick.id)
    expect(pickIds.indexOf("neuralwatt/glm-5.2")).toBeGreaterThan(pickIds.indexOf("openai/gpt-flash"))
  })

  it("stays neutral when the prefer_providers list is empty", async () => {
    const state = stateWith(makeCache(MIXED_TIERS))
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "fast" } })
    const result = JSON.parse((response as any).result.content[0].text)
    expect(result.picks[0].id).toBe("openai/gpt-flash")
  })

  it("applies the provider boost after an explicit prefer hint", async () => {
    const cache = makeCache(MIXED_TIERS)
    const state = stateWith(cache, { campaign: ["openai/gpt-flash"] }, ["neuralwatt"])
    const response = await call(state, "tools/call", { name: "catalog_pick", arguments: { need: "campaign" } })
    const result = JSON.parse((response as any).result.content[0].text)
    expect(result.picks[0].id).toBe("openai/gpt-flash")
    expect(result.picks[1].id).toBe("neuralwatt/kimi-flash")
  })

  it("refreshes from the cache file", async () => {
    const state = stateWith(makeCache(SAMPLE))
    const response = await call(state, "tools/call", { name: "catalog_refresh" })
    const result = JSON.parse((response as any).result.content[0].text)
    expect(result.refreshed).toBe(true)
    expect(result.modelCount).toBe(3)
  })

  it("advertises three tools", async () => {
    const response = await call(stateWith(makeCache(SAMPLE)), "tools/list")
    const tools = (response as any).result.tools.map((tool: { name: string }) => tool.name)
    expect(tools).toEqual(["catalog_list", "catalog_pick", "catalog_refresh"])
  })
})
