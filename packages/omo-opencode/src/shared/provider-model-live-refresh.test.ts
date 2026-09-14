/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import {
  extractProviderEndpoints,
  fetchLiveProviderModelIds,
  mergeLiveProviderModels,
  refreshProviderModelsLive,
  type ModelMetadata,
  type ProviderEndpoint,
  type ProviderLike,
} from "./provider-model-live-refresh"

function makeProvider(overrides: Partial<ProviderLike> = {}): ProviderLike {
  return {
    id: "neuralwatt",
    env: ["NEURALWATT_API_KEY"],
    key: "sk-test",
    models: {
      "glm-5.3": { id: "glm-5.3", api: { url: "https://api.neuralwatt.com/v1", npm: "@ai-sdk/openai-compatible" } },
    },
    ...overrides,
  }
}

function okResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200 })
}

describe("mergeLiveProviderModels", () => {
  test("appends a new live id while preserving previous metadata", () => {
    //#given
    const previous: ModelMetadata[] = [{ id: "glm-5.3", context: 128000 }]

    //#when
    const merged = mergeLiveProviderModels(
      previous,
      ["glm-5.3", "glm-5.3-flash"],
      "neuralwatt",
      "https://api.neuralwatt.com/v1",
    )

    //#then
    expect(merged).toEqual([
      { id: "glm-5.3", context: 128000 },
      { id: "glm-5.3-flash", providerID: "neuralwatt", api: { url: "https://api.neuralwatt.com/v1" } },
    ])
  })

  test("drops previous ids no longer returned live", () => {
    //#given
    const previous: ModelMetadata[] = [{ id: "ox-alpha-free" }, { id: "glm-5.3" }]

    //#when
    const merged = mergeLiveProviderModels(previous, ["glm-5.3"], "go-b", "https://api.example.com/v1")

    //#then
    expect(merged).toEqual([{ id: "glm-5.3" }])
  })

  test("returns previous unchanged when liveIds is empty", () => {
    //#given
    const previous: ModelMetadata[] = [{ id: "glm-5.3" }]

    //#when
    const merged = mergeLiveProviderModels(previous, [], "neuralwatt", "https://api.example.com/v1")

    //#then
    expect(merged).toBe(previous)
  })
})

describe("extractProviderEndpoints", () => {
  test("skips providers that are not openai-compatible", () => {
    //#given
    const anthropic: ProviderLike = {
      id: "anthropic",
      env: ["ANTHROPIC_API_KEY"],
      key: "sk-ant",
      models: { "claude-opus": { id: "claude-opus", api: { npm: "@ai-sdk/anthropic" } } },
    }

    //#when
    const endpoints = extractProviderEndpoints([anthropic])

    //#then
    expect(endpoints).toEqual([])
  })

  test("skips providers without a resolvable key", () => {
    //#given
    const provider = makeProvider({ key: undefined, env: ["MISSING_KEY"], options: {} })

    //#when
    const endpoints = extractProviderEndpoints([provider])

    //#then
    expect(endpoints).toEqual([])
  })

  test("returns an endpoint for an openai-compatible provider with key", () => {
    //#given
    const provider = makeProvider()

    //#when
    const endpoints = extractProviderEndpoints([provider])

    //#then
    expect(endpoints).toEqual([
      { providerID: "neuralwatt", baseURL: "https://api.neuralwatt.com/v1", apiKey: "sk-test" },
    ])
  })

  test("falls back to options.baseURL when the model api has no url", () => {
    //#given
    const provider = makeProvider({
      models: { "glm-5.3": { id: "glm-5.3", api: { npm: "@ai-sdk/openai-compatible" } } },
      options: { baseURL: "https://api.neuralwatt.com/v1" },
    })

    //#when
    const endpoints = extractProviderEndpoints([provider])

    //#then
    expect(endpoints).toEqual([
      { providerID: "neuralwatt", baseURL: "https://api.neuralwatt.com/v1", apiKey: "sk-test" },
    ])
  })
})

describe("fetchLiveProviderModelIds", () => {
  test("parses { data: [{ id }] } shapes", async () => {
    //#given
    const endpoint: ProviderEndpoint = { providerID: "neuralwatt", baseURL: "https://api.neuralwatt.com/v1", apiKey: "sk-test" }
    const fetchImpl = async () => okResponse({ data: [{ id: "a" }, { id: "b" }] })

    //#when
    const ids = await fetchLiveProviderModelIds(endpoint, { fetchImpl })

    //#then
    expect(ids).toEqual(["a", "b"])
  })

  test("returns null on non-2xx without throwing", async () => {
    //#given
    const endpoint: ProviderEndpoint = { providerID: "neuralwatt", baseURL: "https://api.neuralwatt.com/v1", apiKey: "sk-test" }
    const fetchImpl = async () => new Response("nope", { status: 401 })

    //#when
    const ids = await fetchLiveProviderModelIds(endpoint, { fetchImpl })

    //#then
    expect(ids).toBeNull()
  })

  test("never throws when fetchImpl rejects", async () => {
    //#given
    const endpoint: ProviderEndpoint = { providerID: "neuralwatt", baseURL: "https://api.neuralwatt.com/v1", apiKey: "sk-test" }
    const fetchImpl = async () => {
      throw new Error("network down")
    }

    //#when / #then
    await expect(fetchLiveProviderModelIds(endpoint, { fetchImpl })).resolves.toBeNull()
  })
})

describe("refreshProviderModelsLive", () => {
  test("keeps previous models when a fetch returns null", async () => {
    //#given
    const previous: Record<string, ModelMetadata[]> = { neuralwatt: [{ id: "glm-5.3" }] }
    const fetchImpl = async () => new Response("no", { status: 500 })

    //#when
    const result = await refreshProviderModelsLive([makeProvider()], previous, { fetchImpl })

    //#then
    expect(result).toEqual({ neuralwatt: [{ id: "glm-5.3" }] })
  })

  test("merges live ids and drops stale ones", async () => {
    //#given
    const previous: Record<string, ModelMetadata[]> = { neuralwatt: [{ id: "glm-5.3" }, { id: "gone" }] }
    const fetchImpl = async () => okResponse({ data: [{ id: "glm-5.3" }, { id: "glm-5.3-flash" }] })

    //#when
    const result = await refreshProviderModelsLive([makeProvider()], previous, { fetchImpl })

    //#then
    expect(result.neuralwatt).toEqual([
      { id: "glm-5.3" },
      { id: "glm-5.3-flash", providerID: "neuralwatt", api: { url: "https://api.neuralwatt.com/v1" } },
    ])
  })
})
