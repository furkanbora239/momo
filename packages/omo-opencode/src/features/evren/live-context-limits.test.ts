import { describe, expect, it } from "bun:test"
import { LIVE_MODEL_LIMIT_SOURCE } from "../../shared/provider-model-live-refresh"
import type { ProviderModelsCache } from "../../shared/connected-providers-cache"
import { readEvrenLiveContextLimits } from "./live-context-limits"

function cacheWithEvren(entries: unknown[]): ProviderModelsCache {
  return {
    models: { evren: entries },
    connected: ["evren"],
    updatedAt: "2026-09-22T00:00:00.000Z",
  } as ProviderModelsCache
}

describe("readEvrenLiveContextLimits", () => {
  it("#given a missing or malformed cache #when read #then no limits are returned", () => {
    expect(readEvrenLiveContextLimits(null)).toEqual({})
    expect(readEvrenLiveContextLimits(undefined)).toEqual({})
    expect(readEvrenLiveContextLimits({ models: {}, connected: [], updatedAt: "" } as ProviderModelsCache)).toEqual({})
  })

  it("#given gateway-marked entries #when read #then their context limits are returned", () => {
    const cache = cacheWithEvren([
      { id: "glm-5.3", limit: { context: 131072 }, limitSource: LIVE_MODEL_LIMIT_SOURCE },
      { id: "auto", limit: { context: 262144.9 }, limitSource: LIVE_MODEL_LIMIT_SOURCE },
    ])

    expect(readEvrenLiveContextLimits(cache)).toEqual({ "glm-5.3": 131072, auto: 262144 })
  })

  it("#given entries without the gateway marker #when read #then they are ignored", () => {
    const cache = cacheWithEvren([
      { id: "glm-5.3", limit: { context: 250000 } },
      { id: "auto", limit: { context: 250000 }, limitSource: "other" },
      "deepseek-v4-flash",
    ])

    expect(readEvrenLiveContextLimits(cache)).toEqual({})
  })

  it("#given marked entries with invalid limits #when read #then they are ignored", () => {
    const cache = cacheWithEvren([
      { id: "a", limit: { context: 0 }, limitSource: LIVE_MODEL_LIMIT_SOURCE },
      { id: "b", limit: { context: -10 }, limitSource: LIVE_MODEL_LIMIT_SOURCE },
      { id: "c", limit: { context: "250000" }, limitSource: LIVE_MODEL_LIMIT_SOURCE },
      { id: "d", limitSource: LIVE_MODEL_LIMIT_SOURCE },
      { id: "", limit: { context: 131072 }, limitSource: LIVE_MODEL_LIMIT_SOURCE },
    ])

    expect(readEvrenLiveContextLimits(cache)).toEqual({})
  })
})
