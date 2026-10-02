import { describe, expect, it } from "bun:test"
import {
  appendV1ProviderModels,
  convertV1ModelConfigToV2,
  convertV1ProviderConfigToV2,
  convertV2ModelInfoToV1Seed,
  convertV2ProviderInfoToV1Seed,
  type V2ModelListRecord,
  type V2ProviderListRecord,
} from "./provider-config-converter"

function createModelRecord(overrides: Partial<V2ModelListRecord> = {}): V2ModelListRecord {
  return {
    id: "mod-1",
    modelID: "mod-1",
    providerID: "prov-1",
    name: "Model One",
    capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [{ input: 0.5, output: 1.5, cache: { read: 0.1, write: 0.2 } }],
    status: "active",
    enabled: true,
    limit: { context: 1000, output: 500 },
    ...overrides,
  }
}

function createProviderRecord(overrides: Partial<V2ProviderListRecord> = {}): V2ProviderListRecord {
  return {
    id: "prov-1",
    name: "Provider One",
    activation: "auto",
    package: "@ai-sdk/fixture",
    models: new Map(),
    ...overrides,
  }
}

describe("#given a V1 model config", () => {
  it("#when convertV1ModelConfigToV2 is called then a registry-complete Model.Info comes back", () => {
    const info = convertV1ModelConfigToV2("prov-1", "fixture-model", {
      name: "Fixture Model",
      limit: { context: 100, output: 40 },
      tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      status: "beta",
      release_date: "2026-01-02",
      cost: { input: 0.25, output: 0.75, cache_read: 0.05, cache_write: 0.1 },
    })
    expect(info.id).toBe("fixture-model")
    expect(info.modelID).toBe("fixture-model")
    expect(info.providerID).toBe("prov-1")
    expect(info.name).toBe("Fixture Model")
    expect(info.capabilities).toEqual({ tools: true, input: ["text", "image"], output: ["text"] })
    expect(info.variants).toEqual([])
    expect(info.status).toBe("beta")
    expect(info.enabled).toBe(true)
    expect(info.limit).toEqual({ context: 100, output: 40 })
    expect(info.time.released).toBe(Date.parse("2026-01-02"))
    expect(info.cost).toEqual([
      { input: 0.25, output: 0.75, cache: { read: 0.05, write: 0.1 } },
    ])
  })

  it("#when optional V1 fields are missing then documented fallbacks fill the registry fields", () => {
    const info = convertV1ModelConfigToV2("prov-1", "fixture-model", {})
    expect(info.name).toBe("fixture-model")
    expect(info.capabilities).toEqual({ tools: true, input: ["text"], output: ["text"] })
    expect(info.status).toBe("active")
    expect(info.time.released).toBe(0)
    expect(info.cost).toEqual([])
    expect(info.limit).toEqual({ context: 0, output: 0 })
  })
})

describe("#given a V1 provider config", () => {
  it("#when convertV1ProviderConfigToV2 is called then name, package, and options map over", () => {
    const info = convertV1ProviderConfigToV2("fixture-provider", {
      npm: "@ai-sdk/fixture",
      name: "Fixture Provider",
      options: { baseURL: "https://fixture.example/v1" },
    })
    expect(info.id).toBe("fixture-provider")
    expect(info.name).toBe("Fixture Provider")
    expect(info.package).toBe("@ai-sdk/fixture")
    expect(info.activation).toBe("enabled")
    expect(info.settings).toEqual({ baseURL: "https://fixture.example/v1" })
  })
})

describe("#given an existing V2 model list and V1 model entries", () => {
  it("#when appendV1ProviderModels is called then missing ids append and existing ids stay", () => {
    const existing = [convertV1ModelConfigToV2("prov-1", "mod-1", { name: "Kept Model" })]
    const merged = appendV1ProviderModels("prov-1", existing, {
      "mod-1": { name: "Ignored Duplicate" },
      "mod-2": { name: "Injected Model", limit: { context: 50, output: 20 } },
    })
    expect(merged.map((info) => info.modelID)).toEqual(["mod-1", "mod-2"])
    expect(merged[0].name).toBe("Kept Model")
    expect(merged[0].providerID).toBe("prov-1")
    expect(merged[1].name).toBe("Injected Model")
  })
})

describe("#given V2 list records", () => {
  it("#when the seed converters run then V1-shaped entries come back", () => {
    const providerSeed = convertV2ProviderInfoToV1Seed(
      createProviderRecord({ settings: { baseURL: "https://fixture.example/v1" } }),
    )
    expect(providerSeed).toEqual({
      name: "Provider One",
      npm: "@ai-sdk/fixture",
      options: { baseURL: "https://fixture.example/v1" },
    })

    const modelSeed = convertV2ModelInfoToV1Seed(createModelRecord())
    expect(modelSeed).toEqual({
      name: "Model One",
      limit: { context: 1000, output: 500 },
      tool_call: true,
      modalities: { input: ["text", "image"], output: ["text"] },
      cost: { input: 0.5, output: 1.5, cache_read: 0.1, cache_write: 0.2 },
      status: "active",
    })
  })
})
