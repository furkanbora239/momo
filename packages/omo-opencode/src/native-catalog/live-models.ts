import { createHash } from "node:crypto"
import type { ModelInfo, ProviderInfo, ConnectionInfo } from "@opencode/client"
import type { Credential } from "@opencode/schema/credential"
import type { NativeCatalogAdapterOptions } from "./types"

export type { ProviderInfo }

export interface NativeLiveModel {
  readonly id: string
  readonly contextLength?: number
}

export interface NativeLiveModelsResult {
  readonly models: Map<string, NativeLiveModel>
  readonly authoritative: boolean
  readonly unavailable?: { readonly reason: string; readonly statusCode?: number }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function recordString(record: unknown, key: string): string | undefined {
  return isRecord(record) && typeof record[key] === "string" ? record[key] : undefined
}

function packageIsOpenAICompatible(provider: ProviderInfo, model: ModelInfo): boolean {
  return `${provider.package} ${model.package ?? ""}`.toLowerCase().includes("openai-compatible")
}

function baseURL(provider: ProviderInfo, model: ModelInfo): string | undefined {
  const modelURL = recordString(model.settings, "baseURL") ?? recordString(model.settings, "baseUrl")
  const providerURL = recordString(provider.settings, "baseURL") ?? recordString(provider.settings, "baseUrl")
  return (modelURL ?? providerURL)?.replace(/\/+$/, "")
}

function credentialSecret(value: Credential.Value | undefined): string | undefined {
  if (!value) return undefined
  return value.type === "key" ? value.key : value.access
}

async function resolveAuth(options: NativeCatalogAdapterOptions, provider: ProviderInfo): Promise<{ apiKey?: string; binding?: string }> {
  if (provider.integrationID) {
    const connection = await options.context.integration.connection.active(provider.integrationID)
    if (connection) {
      const nativeSecret = credentialSecret(await options.context.integration.connection.resolve(connection as ConnectionInfo))
      if (nativeSecret) return { apiKey: nativeSecret, binding: JSON.stringify(connection) }
    }
  }
  return { apiKey: recordString(provider.settings, "apiKey") }
}

function reportError(options: NativeCatalogAdapterOptions, message: string, error: unknown): void {
  if (options.onError) options.onError(message, error)
  else console.error(`[native-catalog] ${message}`, error)
}

interface DiscoveryCacheEntry {
  readonly identity: string
  readonly expiresAt: number
  readonly result: NativeLiveModelsResult
}

/** Remote discovery only: callers must still recheck local admission on every read. */
export function createNativeLiveModelCache() {
  return new Map<string, DiscoveryCacheEntry>()
}

export async function fetchNativeLiveModels(
  options: NativeCatalogAdapterOptions,
  provider: ProviderInfo,
  models: readonly ModelInfo[],
  markUnavailable: (providerID: string, input: { reason: string; statusCode?: number }) => void,
  cache?: ReturnType<typeof createNativeLiveModelCache>,
): Promise<NativeLiveModelsResult> {
  const result = new Map<string, NativeLiveModel>()
  const compatibleModels = models.filter((model) => model.providerID === provider.id && packageIsOpenAICompatible(provider, model))
  const baseModel = compatibleModels.find((model) => baseURL(provider, model))
  if (!baseModel) return { models: result, authoritative: false }
  const endpoint = baseURL(provider, baseModel)
  if (!endpoint) return { models: result, authoritative: false }
  const { apiKey, binding } = await resolveAuth(options, provider)
  const now = options.now ?? Date.now
  const identity = createHash("sha256").update(JSON.stringify([endpoint, provider.integrationID, binding, apiKey])).digest("hex")
  const cached = cache?.get(provider.id)
  if (cached && cached.identity === identity && now() < cached.expiresAt) return cached.result
  cache?.delete(provider.id)
  function remember(value: NativeLiveModelsResult): NativeLiveModelsResult {
    if (cache) {
      for (const [id, entry] of cache) if (now() >= entry.expiresAt) cache.delete(id)
      if (cache.size >= 128) cache.delete(cache.keys().next().value!)
      cache.set(provider.id, { identity, expiresAt: now() + 30_000, result: value })
    }
    return value
  }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await (options.fetchImpl ?? fetch)(`${endpoint}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    })
    // OpenAI-compatible inference does not require a model discovery endpoint.
    if (response.status === 404 || response.status === 405) return remember({ models: result, authoritative: false })
    if (!response.ok) {
      const unavailable = { reason: `live model endpoint returned HTTP ${response.status}`, statusCode: response.status }
      markUnavailable(provider.id, unavailable)
      reportError(options, `live model refresh failed for provider ${provider.id}`, new Error(unavailable.reason))
      return { models: result, authoritative: false, unavailable }
    }
    const payload: unknown = await response.json()
    const isList = Array.isArray(payload) || isRecord(payload) && Array.isArray(payload.data)
    if (!isList) {
      const unavailable = { reason: "live model endpoint returned an invalid response" }
      markUnavailable(provider.id, unavailable)
      reportError(options, `live model refresh failed for provider ${provider.id}`, new Error(unavailable.reason))
      return { models: result, authoritative: false, unavailable }
    }
    const entries = Array.isArray(payload) ? payload : isRecord(payload) && Array.isArray(payload.data) ? payload.data : []
    for (const entry of entries) {
      if (!isRecord(entry) || typeof entry.id !== "string") continue
      const contextLength = finiteNumber(entry.context_length) ?? finiteNumber(entry.max_model_len) ?? finiteNumber(entry.context_window)
      result.set(entry.id, { id: entry.id, ...(contextLength === undefined ? {} : { contextLength }) })
    }
    return remember({ models: result, authoritative: true })
  } catch (error) {
    const unavailable = { reason: "live model endpoint could not be reached" }
    markUnavailable(provider.id, unavailable)
    reportError(options, `live model refresh failed for provider ${provider.id}`, error)
    return { models: result, authoritative: false, unavailable }
  } finally {
    clearTimeout(timeout)
  }
}
