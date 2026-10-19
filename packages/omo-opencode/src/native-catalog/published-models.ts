// MODIFIED: bounded, source-backed model descriptions and prices for native classification.
import type { ModelInfo, ProviderInfo } from "@opencode/client"
import type { NativePublishedModelMetadata } from "../native-routing/types"
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export interface NativePublishedModel extends NativePublishedModelMetadata {
  readonly inputPricePerMillion?: number
  readonly outputPricePerMillion?: number
}
const source = "https://models.dev/api.json"
const maxBytes = 16 * 1024 * 1024
const ttl = 24 * 60 * 60 * 1000
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) }
function text(value: unknown, limit: number): string | undefined { return typeof value === "string" && value.trim() ? value.trim().slice(0, limit) : undefined }
function price(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined }

function endpoint(value: unknown): string | undefined { return typeof value === "string" ? value.replace(/\/+$/, "") : undefined }
function packageName(value: string): string { return value.replace(/^aisdk:/, "").replace(/^@opencode\/ai\/providers\//, "@ai-sdk/") }
function sameEndpoint(expected: string | undefined, observed: string | undefined, providerID: string): boolean {
  if (expected === observed) return expected !== undefined
  const official = ["https://opencode.ai/zen/v1", "https://opencode.ai/inference/openai/v1"]
  return providerID === "opencode" && expected !== undefined && observed !== undefined && official.includes(expected) && official.includes(observed)
}
function matchesTransport(provider: Record<string, unknown>, entry: Record<string, unknown>, model: ModelInfo, runtime?: ProviderInfo): boolean {
  const publishedProvider = record(entry.provider) ? entry.provider : {}
  const publishedEndpoint = endpoint(publishedProvider.api) ?? endpoint(provider.api)
  const modelEndpoint = model.settings?.baseURL ?? model.settings?.baseUrl
  const runtimeEndpoint = modelEndpoint ?? runtime?.settings?.baseURL ?? runtime?.settings?.baseUrl
  if (runtimeEndpoint !== undefined && !sameEndpoint(publishedEndpoint, endpoint(runtimeEndpoint), model.providerID)) return false
  const publishedPackage = publishedProvider.npm ?? provider.npm
  if (typeof publishedPackage === "string" && ((model.package !== undefined && packageName(model.package) !== packageName(publishedPackage)) || (runtime && packageName(runtime.package) !== packageName(publishedPackage)))) return false
  return true
}

export function publishedModelEntries(payload: unknown, models: readonly ModelInfo[], providers: readonly ProviderInfo[] = []): ReadonlyMap<string, NativePublishedModel> {
  const result = new Map<string, NativePublishedModel>()
  if (!record(payload)) return result
  for (const model of models) {
    const provider = payload[model.providerID]
    if (!record(provider) || !record(provider.models)) continue
    // Match the transport identity, never a similarly named family or free suffix.
    const entry = provider.models[model.modelID]
    if (!record(entry) || entry.id !== model.modelID || !matchesTransport(provider, entry, model, providers.find((item) => item.id === model.providerID))) continue
    const cost = record(entry.cost) ? entry.cost : {}
    result.set(`${model.providerID}/${model.id}`, {
      source,
      ...(text(entry.name, 160) ? { name: text(entry.name, 160) } : {}),
      ...(text(entry.description, 1600) ? { description: text(entry.description, 1600) } : {}),
      ...(text(entry.family, 160) ? { family: text(entry.family, 160) } : {}),
      ...(typeof entry.reasoning === "boolean" ? { reasoning: entry.reasoning } : {}),
      ...(price(cost.input) === undefined ? {} : { inputPricePerMillion: price(cost.input) }),
      ...(price(cost.output) === undefined ? {} : { outputPricePerMillion: price(cost.output) }),
    })
  }
  return result
}

export function createNativePublishedModelReader(options: {
  readonly cachePath?: string
  readonly fetchImpl?: typeof fetch
  readonly now?: () => number
  readonly onError?: (error: unknown) => void
} = {}) {
  const now = options.now ?? Date.now
  let cached: { fetchedAt: number; payload: unknown } | undefined
  let pending: Promise<unknown> | undefined
  let retryAt = 0
  if (options.cachePath) {
    try {
      const raw = readFileSync(options.cachePath, "utf8")
      if (Buffer.byteLength(raw) <= maxBytes) {
        const saved: unknown = JSON.parse(raw)
        if (record(saved) && typeof saved.fetchedAt === "number" && record(saved.payload)) cached = { fetchedAt: saved.fetchedAt, payload: saved.payload }
      }
    } catch (error) { options.onError?.(error) }
  }
  async function load(): Promise<unknown> {
    if (cached && now() >= cached.fetchedAt && now() - cached.fetchedAt < ttl) return cached.payload
    if (now() < retryAt) return undefined
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await (options.fetchImpl ?? fetch)(source, { signal: controller.signal })
      if (!response.ok || !response.body) throw new Error(`published model metadata HTTP ${response.status}`)
      const reader = response.body.getReader(), chunks: Uint8Array[] = []
      let size = 0
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > maxBytes) { await reader.cancel(); throw new Error("published model metadata exceeds byte limit") }
        chunks.push(chunk.value)
      }
      const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
      if (!record(payload)) throw new Error("published model metadata is not an object")
      cached = { fetchedAt: now(), payload }
      if (options.cachePath) {
        mkdirSync(dirname(options.cachePath), { recursive: true })
        const temporary = `${options.cachePath}.${process.pid}.${crypto.randomUUID()}.tmp`
        writeFileSync(temporary, JSON.stringify(cached), { mode: 0o600 })
        renameSync(temporary, options.cachePath)
      }
      return payload
    } catch (error) { retryAt = now() + 60_000; options.onError?.(error); return undefined }
    finally { clearTimeout(timer) }
  }
  return async (models: readonly ModelInfo[], providers: readonly ProviderInfo[] = []): Promise<ReadonlyMap<string, NativePublishedModel>> => {
    pending ??= load().finally(() => { pending = undefined })
    return publishedModelEntries(await pending, models, providers)
  }
}
