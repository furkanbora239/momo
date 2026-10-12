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

async function resolveApiKey(options: NativeCatalogAdapterOptions, provider: ProviderInfo): Promise<string | undefined> {
  if (provider.integrationID) {
    const connection = await options.context.integration.connection.active(provider.integrationID)
    if (connection) {
      const nativeSecret = credentialSecret(await options.context.integration.connection.resolve(connection as ConnectionInfo))
      if (nativeSecret) return nativeSecret
    }
  }
  return recordString(provider.settings, "apiKey")
}

function reportError(options: NativeCatalogAdapterOptions, message: string, error: unknown): void {
  if (options.onError) options.onError(message, error)
  else console.error(`[native-catalog] ${message}`, error)
}

export async function fetchNativeLiveModels(
  options: NativeCatalogAdapterOptions,
  provider: ProviderInfo,
  models: readonly ModelInfo[],
  markUnavailable: (providerID: string, input: { reason: string; statusCode?: number }) => void,
): Promise<NativeLiveModelsResult> {
  const result = new Map<string, NativeLiveModel>()
  const compatibleModels = models.filter((model) => model.providerID === provider.id && packageIsOpenAICompatible(provider, model))
  const baseModel = compatibleModels.find((model) => baseURL(provider, model))
  if (!baseModel) return { models: result, authoritative: false }
  const endpoint = baseURL(provider, baseModel)
  if (!endpoint) return { models: result, authoritative: false }
  const apiKey = await resolveApiKey(options, provider)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await (options.fetchImpl ?? fetch)(`${endpoint}/models`, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    })
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
    return { models: result, authoritative: true }
  } catch (error) {
    const unavailable = { reason: "live model endpoint could not be reached" }
    markUnavailable(provider.id, unavailable)
    reportError(options, `live model refresh failed for provider ${provider.id}`, error)
    return { models: result, authoritative: false, unavailable }
  } finally {
    clearTimeout(timeout)
  }
}
