import { describe, expect, test } from "bun:test"

import {
  computeLiveOnlyModelConfigEntries,
  createLiveModelConfigInjector,
  type ProviderModelConfigEntry,
} from "./provider-model-config-injection"
import type { ModelPool, ProviderModelsCache } from "./connected-providers-cache"

function emptyPool(): ModelPool {
  return { version: 1, allowed: [], updatedAt: "2026-01-01T00:00:00.000Z" }
}

function poolWith(entries: { providerID: string; modelID: string }[]): ModelPool {
  return { version: 1, allowed: entries, updatedAt: "2026-01-01T00:00:00.000Z" }
}

describe("computeLiveOnlyModelConfigEntries", () => {
  test("given live ids with registry overlap and existing config models, when computing, then only missing live ids are returned", () => {
    const entries = computeLiveOnlyModelConfigEntries({
      providerID: "neuralwatt",
      existingConfigModels: { "glm-5.3-flash": { name: "existing" } },
      registryModelIds: ["glm-5.2", "kimi-k3"],
      liveModelIds: ["glm-5.2", "glm-5.3-flash", "glm-5.3-flash-flex", "deepseek-v4.1-flash"],
    })

    expect(Object.keys(entries).sort()).toEqual(["deepseek-v4.1-flash", "glm-5.3-flash-flex"])
  })

  test("given cached metadata, when computing, then entries carry derived limit and capability flags", () => {
    const entries = computeLiveOnlyModelConfigEntries({
      providerID: "neuralwatt",
      existingConfigModels: {},
      registryModelIds: [],
      liveModelIds: ["glm-5.3-flash"],
      cachedMetadata: [
        {
          id: "glm-5.3-flash",
          name: "GLM 5.3 Flash",
          context: 200000,
          limit: { output: 32000 },
          reasoning: true,
          tool_call: true,
        },
      ],
    })

    expect(entries["glm-5.3-flash"]).toEqual({
      name: "GLM 5.3 Flash",
      limit: { context: 200000, output: 32000 },
      reasoning: true,
      tool_call: true,
    })
  })

  test("given metadata without limits, when computing, then limit keys are omitted instead of invented", () => {
    const entries = computeLiveOnlyModelConfigEntries({
      providerID: "neuralwatt",
      existingConfigModels: {},
      registryModelIds: [],
      liveModelIds: ["mystery-model"],
      cachedMetadata: [{ id: "mystery-model" }],
    })

    expect(entries["mystery-model"]).toEqual({ name: "mystery-model" })
  })

  test("given empty provider id or empty live ids, when computing, then the result is empty", () => {
    const base = {
      existingConfigModels: {},
      registryModelIds: [],
      liveModelIds: ["glm-5.3-flash"],
    }

    expect(Object.keys(computeLiveOnlyModelConfigEntries({ ...base, providerID: "" }))).toEqual([])
    expect(
      Object.keys(
        computeLiveOnlyModelConfigEntries({
          providerID: "neuralwatt",
          existingConfigModels: {},
          registryModelIds: [],
          liveModelIds: [],
        }),
      ),
    ).toEqual([])
  })

  test("given a non-empty pool, when computing, then only allowed ids survive", () => {
    const base = {
      providerID: "neuralwatt",
      existingConfigModels: {},
      registryModelIds: [],
      liveModelIds: ["glm-5.3-flash", "deepseek-v4.1-flash"],
    }

    const restricted = computeLiveOnlyModelConfigEntries({
      ...base,
      pool: poolWith([{ providerID: "neuralwatt", modelID: "glm-5.3-flash" }]),
    })
    expect(Object.keys(restricted)).toEqual(["glm-5.3-flash"])

    const open = computeLiveOnlyModelConfigEntries({ ...base, pool: emptyPool() })
    expect(Object.keys(open).sort()).toEqual(["deepseek-v4.1-flash", "glm-5.3-flash"])
  })

  test("given a pool for another provider, when computing, then ids of this provider are excluded", () => {
    const entries = computeLiveOnlyModelConfigEntries({
      providerID: "neuralwatt",
      existingConfigModels: {},
      registryModelIds: [],
      liveModelIds: ["glm-5.3-flash"],
      pool: poolWith([{ providerID: "openai", modelID: "glm-5.3-flash" }]),
    })

    expect(entries).toEqual({})
  })
})

describe("createLiveModelConfigInjector", () => {
  type InjectorDeps = {
    readProviderModelsCache: () => ProviderModelsCache | null
    readModelPool: () => ModelPool
  }

  function makeCache(overrides: Partial<ProviderModelsCache> = {}): ProviderModelsCache {
    return {
      models: {
        neuralwatt: [
          { id: "glm-5.2", name: "GLM 5.2", context: 128000 },
          { id: "glm-5.3-flash", name: "GLM 5.3 Flash" },
          { id: "deepseek-v4.1-flash" },
        ],
      },
      registryModels: { neuralwatt: ["glm-5.2"] },
      connected: ["neuralwatt"],
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    }
  }

  function makeConfig(providerModels?: Record<string, unknown>): Record<string, unknown> {
    return {
      provider: {
        neuralwatt: {
          options: { baseURL: "https://api.neuralwatt.dev/v1" },
          ...(providerModels ? { models: providerModels } : {}),
        },
      },
    }
  }

  function createInjector(deps: Partial<InjectorDeps> = {}) {
    return createLiveModelConfigInjector({
      readProviderModelsCache: deps.readProviderModelsCache ?? (() => makeCache()),
      readModelPool: deps.readModelPool ?? (() => emptyPool()),
    })
  }

  test("given config without models, when injecting, then a models map is created with live-only ids", () => {
    const config = makeConfig()
    createInjector()(config)

    const models = (config.provider as Record<string, { models?: Record<string, ProviderModelConfigEntry> }>)
      .neuralwatt.models
    expect(Object.keys(models ?? {})).toEqual(["glm-5.3-flash", "deepseek-v4.1-flash"])
    expect(models?.["glm-5.3-flash"]).toEqual({ name: "GLM 5.3 Flash" })
    expect(models?.["deepseek-v4.1-flash"]).toEqual({ name: "deepseek-v4.1-flash" })
  })

  test("given existing config models, when injecting, then existing entries stay byte-identical and only missing ids are added", () => {
    const existing = { "glm-5.3-flash": { name: "custom", limit: { context: 5 } } }
    const config = makeConfig(existing)
    createInjector()(config)

    const models = (config.provider as Record<string, { models: Record<string, unknown> }>).neuralwatt.models
    expect(models["glm-5.3-flash"]).toBe(existing["glm-5.3-flash"])
    expect(JSON.stringify(models["glm-5.3-flash"])).toBe(JSON.stringify({ name: "custom", limit: { context: 5 } }))
    expect(Object.keys(models).sort()).toEqual(["deepseek-v4.1-flash", "glm-5.3-flash"])
  })

  test("given every live id already present, when injecting, then config is untouched", () => {
    const config = makeConfig({ "glm-5.2": { name: "a" }, "glm-5.3-flash": { name: "b" }, "deepseek-v4.1-flash": { name: "c" } })
    const before = JSON.stringify(config)
    createInjector()(config)

    expect(JSON.stringify(config)).toBe(before)
  })

  test("given a missing cache, when injecting, then config is untouched", () => {
    const config = makeConfig()
    const before = JSON.stringify(config)
    createInjector({ readProviderModelsCache: () => null })(config)

    expect(JSON.stringify(config)).toBe(before)
  })

  test("given a provider with no cache models, when injecting, then it is skipped", () => {
    const config = {
      provider: {
        emptyprovider: { options: {} },
      },
    }
    createInjector()(config)

    // neuralwatt is connected and absent from config, so it legitimately gets
    // a minimal entry; the provider under test (no cache models) must not.
    const providers = config.provider as Record<string, unknown>
    expect(providers.emptyprovider).toEqual({ options: {} })
    expect(providers).toHaveProperty("neuralwatt")
  })

  test("given a provider entry that is not an object, when injecting, then it is skipped without throwing", () => {
    const config = { provider: { broken: "not-an-object" } }
    createInjector()(config)

    // The malformed entry is never overwritten; connected-but-absent
    // providers may still gain a minimal entry.
    const providers = config.provider as Record<string, unknown>
    expect(providers.broken).toBe("not-an-object")
  })

  test("given a non-empty pool, when injecting, then non-allowed ids are not injected", () => {
    const config = makeConfig()
    createInjector({
      readModelPool: () => poolWith([{ providerID: "neuralwatt", modelID: "glm-5.2" }]),
    })(config)

    const models = (config.provider as Record<string, { models?: Record<string, unknown> }>).neuralwatt.models
    expect(models?.["glm-5.3-flash"]).toBeUndefined()
  })

  test("given a provider absent from config but present in cache.connected, when injecting, then a minimal provider entry is created containing only the live-only ids", () => {
    const config = { provider: {} }
    createInjector()(config)

    const providers = config.provider as Record<string, { models?: Record<string, ProviderModelConfigEntry> }>
    expect(Object.keys(providers)).toEqual(["neuralwatt"])
    expect(providers.neuralwatt).toEqual({
      models: {
        "glm-5.3-flash": { name: "GLM 5.3 Flash" },
        "deepseek-v4.1-flash": { name: "deepseek-v4.1-flash" },
      },
    })
  })

  test("given a cache without registryModels, when injecting, then the provider is skipped and nothing is injected", () => {
    const cache = makeCache()
    delete (cache as Partial<ProviderModelsCache>).registryModels
    const config = makeConfig()
    const before = JSON.stringify(config)
    createInjector({ readProviderModelsCache: () => cache })(config)

    expect(JSON.stringify(config)).toBe(before)
  })

  test("given registryModels with an empty array for the provider, when injecting, then the provider is skipped", () => {
    const config = makeConfig()
    const before = JSON.stringify(config)
    createInjector({
      readProviderModelsCache: () => makeCache({ registryModels: { neuralwatt: [] } }),
    })(config)

    expect(JSON.stringify(config)).toBe(before)
  })

  test("given a connected provider absent from config and a cache without registryModels, when injecting, then no provider entry is created", () => {
    const cache = makeCache()
    delete (cache as Partial<ProviderModelsCache>).registryModels
    const config = { provider: {} }
    createInjector({ readProviderModelsCache: () => cache })(config)

    expect(config.provider).toEqual({})
  })

  test("given a non-empty pool with two allowed ids, when injecting, then only those ids are injected", () => {
    const config = makeConfig()
    createInjector({
      readModelPool: () =>
        poolWith([
          { providerID: "neuralwatt", modelID: "glm-5.3-flash" },
          { providerID: "neuralwatt", modelID: "deepseek-v4.1-flash" },
        ]),
    })(config)

    const models = (config.provider as Record<string, { models?: Record<string, unknown> }>).neuralwatt.models
    expect(Object.keys(models ?? {}).sort()).toEqual(["deepseek-v4.1-flash", "glm-5.3-flash"])
  })

  test("given a malformed cache payload, when injecting, then it does not throw", () => {
    const config = makeConfig()
    expect(() =>
      createInjector({
        readProviderModelsCache: () =>
          ({ models: "garbage", connected: 42, updatedAt: null }) as unknown as ProviderModelsCache,
      })(config),
    ).not.toThrow()
    expect(config.provider).toBeDefined()
  })
})
