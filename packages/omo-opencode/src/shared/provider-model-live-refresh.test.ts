/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import {
  extractProviderEndpoints,
  fetchLiveProviderModels,
  mergeLiveProviderModels,
  refreshProviderModelsLive,
  LIVE_MODEL_LIMIT_SOURCE,
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

const ENDPOINT: ProviderEndpoint = {
  providerID: "neuralwatt",
  baseURL: "https://api.neuralwatt.com/v1",
  apiKey: "sk-test",
}

describe("mergeLiveProviderModels", () => {
  test("appends a new live id while preserving previous metadata", () => {
    //#given
    const previous: ModelMetadata[] = [{ id: "glm-5.3", context: 128000 }]

    //#when
    const merged = mergeLiveProviderModels(
      previous,
      [{ id: "glm-5.3" }, { id: "glm-5.3-flash" }],
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
    const merged = mergeLiveProviderModels(previous, [{ id: "glm-5.3" }], "go-b", "https://api.example.com/v1")

    //#then
    expect(merged).toEqual([{ id: "glm-5.3" }])
  })

  test("returns previous unchanged when the live list is empty", () => {
    //#given
    const previous: ModelMetadata[] = [{ id: "glm-5.3" }]

    //#when
    const merged = mergeLiveProviderModels(previous, [], "neuralwatt", "https://api.example.com/v1")

    //#then
    expect(merged).toBe(previous)
  })

  test("overlays a gateway-reported context limit and marks the source", () => {
    //#given
    const previous: ModelMetadata[] = [{ id: "glm-5.3", limit: { context: 250000 }, name: "GLM 5.3" }]

    //#when
    const merged = mergeLiveProviderModels(
      previous,
      [{ id: "glm-5.3", contextLimit: 131072 }],
      "neuralwatt",
      "https://api.neuralwatt.com/v1",
    )

    //#then
    expect(merged).toEqual([
      { id: "glm-5.3", name: "GLM 5.3", limit: { context: 131072 }, limitSource: LIVE_MODEL_LIMIT_SOURCE },
    ])
  })

  test("strips a stale live marker when the gateway stops reporting the limit", () => {
    //#given
    const previous: ModelMetadata[] = [
      { id: "glm-5.3", limit: { context: 131072 }, limitSource: LIVE_MODEL_LIMIT_SOURCE },
    ]

    //#when
    const merged = mergeLiveProviderModels(previous, [{ id: "glm-5.3" }], "neuralwatt", "https://api.neuralwatt.com/v1")

    //#then
    expect(merged).toEqual([{ id: "glm-5.3", limit: { context: 131072 } }])
  })

  test("carries the context limit onto brand-new live entries", () => {
    //#when
    const merged = mergeLiveProviderModels(
      [],
      [{ id: "new-model", contextLimit: 262144 }],
      "neuralwatt",
      "https://api.neuralwatt.com/v1",
    )

    //#then
    expect(merged).toEqual([
      {
        id: "new-model",
        providerID: "neuralwatt",
        api: { url: "https://api.neuralwatt.com/v1" },
        limit: { context: 262144 },
        limitSource: LIVE_MODEL_LIMIT_SOURCE,
      },
    ])
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

describe("fetchLiveProviderModels", () => {
  test("parses { data: [{ id }] } shapes", async () => {
    //#given
    const fetchImpl = async () => okResponse({ data: [{ id: "a" }, { id: "b" }] })

    //#when
    const models = await fetchLiveProviderModels(ENDPOINT, { fetchImpl })

    //#then
    expect(models).toEqual([{ id: "a" }, { id: "b" }])
  })

  test("captures context_length and max_model_len when the gateway reports them", async () => {
    //#given
    const fetchImpl = async () =>
      okResponse({
        data: [
          { id: "a", context_length: 262144 },
          { id: "b", max_model_len: 131072 },
          { id: "c", context_length: 0 },
        ],
      })

    //#when
    const models = await fetchLiveProviderModels(ENDPOINT, { fetchImpl })

    //#then
    expect(models).toEqual([
      { id: "a", contextLimit: 262144 },
      { id: "b", contextLimit: 131072 },
      { id: "c" },
    ])
  })

  test("parses plain string model lists", async () => {
    //#given
    const fetchImpl = async () => okResponse(["a", "b"])

    //#when
    const models = await fetchLiveProviderModels(ENDPOINT, { fetchImpl })

    //#then
    expect(models).toEqual([{ id: "a" }, { id: "b" }])
  })

  test("returns null on non-2xx without throwing", async () => {
    //#given
    const fetchImpl = async () => new Response("nope", { status: 401 })

    //#when
    const models = await fetchLiveProviderModels(ENDPOINT, { fetchImpl })

    //#then
    expect(models).toBeNull()
  })

  test("never throws when fetchImpl rejects", async () => {
    //#given
    const fetchImpl = async () => {
      throw new Error("network down")
    }

    //#when / #then
    await expect(fetchLiveProviderModels(ENDPOINT, { fetchImpl })).resolves.toBeNull()
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

  test("stores gateway-reported context limits in the cache entries", async () => {
    //#given
    const previous: Record<string, ModelMetadata[]> = { neuralwatt: [{ id: "glm-5.3", limit: { context: 250000 } }] }
    const fetchImpl = async () => okResponse({ data: [{ id: "glm-5.3", context_length: 131072 }] })

    //#when
    const result = await refreshProviderModelsLive([makeProvider()], previous, { fetchImpl })

    //#then
    expect(result.neuralwatt).toEqual([
      { id: "glm-5.3", limit: { context: 131072 }, limitSource: LIVE_MODEL_LIMIT_SOURCE },
    ])
  })
})
