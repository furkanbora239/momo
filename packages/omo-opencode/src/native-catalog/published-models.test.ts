import { describe, expect, test } from "bun:test"
import type { ModelInfo, ProviderInfo } from "@opencode/client"
import { createNativePublishedModelReader, publishedModelEntries } from "./published-models"
import { jobClassificationInput } from "./job-classification-input"
import { jobClassificationFingerprint } from "./job-classification-identity"
import { createJobClassDefinitions } from "./job-class-definitions"
const models = [{ providerID: "opencode", id: "alias", modelID: "transport" }, { providerID: "other", id: "transport", modelID: "transport" }] as unknown as ModelInfo[]
const payload = { opencode: { models: { transport: { id: "transport", description: "Published coding agent", reasoning: true, cost: { input: 0, output: 0 } } } } }
describe("published native model metadata", () => {
  test("matches exact provider and transport identity and preserves zero price evidence", () => {
    const entries = publishedModelEntries(payload, models)
    expect([...entries.keys()]).toEqual(["opencode/alias"])
    expect(entries.get("opencode/alias")).toMatchObject({ source: "https://models.dev/api.json", description: "Published coding agent", inputPricePerMillion: 0, outputPricePerMillion: 0 })
    expect(publishedModelEntries({ opencode: { models: { transport: { id: "similar-model" } } } }, models).size).toBe(0)
  })
  test("rejects official IDs rebound to private model or provider transports", () => {
    const published = { opencode: { api: "https://opencode.ai/inference/openai/v1", npm: "@ai-sdk/openai-compatible", models: payload.opencode.models } }
    const native = { ...models[0], package: "@ai-sdk/openai-compatible" }
    expect(publishedModelEntries(published, [native]).size).toBe(1)
    expect(publishedModelEntries(published, [{ ...native, settings: { baseURL: "https://private.test/v1" } }]).size).toBe(0)
    expect(publishedModelEntries(published, [{ ...native, package: "private-sdk" }]).size).toBe(0)
    const provider = { id: "opencode", package: "@ai-sdk/openai-compatible", settings: { baseURL: "https://private.test/v1" } } as unknown as ProviderInfo
    expect(publishedModelEntries(published, [native], [provider]).size).toBe(0)
  })
  test("accepts native aisdk package references and official OpenCode endpoint aliases", () => {
    const published = { opencode: { api: "https://opencode.ai/inference/openai/v1", npm: "@ai-sdk/openai-compatible", models: payload.opencode.models } }
    const native = { ...models[0], package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: "https://opencode.ai/zen/v1" } }
    const provider = { id: "opencode", package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: "https://opencode.ai/zen/v1/" } } as unknown as ProviderInfo
    expect(publishedModelEntries(published, [native], [provider]).size).toBe(1)
    const builtin = { ...native, package: "@opencode/ai/providers/openai-compatible" }
    expect(publishedModelEntries(published, [builtin], [{ ...provider, package: builtin.package }]).size).toBe(1)
    expect(publishedModelEntries(published, [{ ...native, package: "aisdk:private-sdk" }], [provider]).size).toBe(0)
    expect(publishedModelEntries(published, [native], [{ ...provider, package: "other:@ai-sdk/openai-compatible" }]).size).toBe(0)
    const otherModel = { ...native, providerID: "other" }
    expect(publishedModelEntries({ other: published.opencode }, [otherModel]).size).toBe(0)
  })
  test("does not invent missing prices or publish unsupported fields", () => {
    const entries = publishedModelEntries({ opencode: { models: { transport: { id: "transport", description: "x".repeat(2000), cost: { input: -1, output: "0" }, strengths: ["invented"] } } } }, models)
    expect(entries.get("opencode/alias")?.description).toHaveLength(1600)
    expect(entries.get("opencode/alias")?.inputPricePerMillion).toBeUndefined()
    expect(entries.get("opencode/alias")?.outputPricePerMillion).toBeUndefined()
  })
  test("coalesces refreshes, expires free pricing and fails closed when source refresh fails", async () => {
    let now = 0, calls = 0, failed = false
    const read = createNativePublishedModelReader({ now: () => now, fetchImpl: async () => { calls++; return failed ? new Response("failure", { status: 503 }) : Response.json(payload) } })
    const results = await Promise.all([read(models), read(models)])
    expect(calls).toBe(1)
    expect(results.every((entries) => entries.size === 1)).toBe(true)
    now = 24 * 60 * 60 * 1000
    failed = true
    expect((await read(models)).size).toBe(0)
    expect((await read(models)).size).toBe(0)
    expect(calls).toBe(2)
  })
  test("invalidates classification only for published suitability content changes", () => {
    const published = publishedModelEntries(payload, models).get("opencode/alias")!
    const model = { providerID: "opencode", id: "alias", available: true, published }
    const definitions = createJobClassDefinitions()
    const first = jobClassificationInput(model)
    const priceChange = jobClassificationInput({ ...model, published: { ...published, inputPricePerMillion: 3 } })
    const descriptionChange = jobClassificationInput({ ...model, published: { ...published, description: "Image processing only" } })
    expect(first.evidence[0]).toMatchObject({ source: "https://models.dev/api.json", facts: { description: "Published coding agent", reasoning: true } })
    expect(jobClassificationFingerprint(definitions, first)).toBe(jobClassificationFingerprint(definitions, priceChange))
    expect(jobClassificationFingerprint(definitions, first)).not.toBe(jobClassificationFingerprint(definitions, descriptionChange))
  })
})
