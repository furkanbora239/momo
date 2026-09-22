// provider-model-live-refresh.ts — reconcile the provider models cache against
// each connected openai-compatible provider's live `GET /models` endpoint.
//
// The plugin writes `provider-models.json` from `client.provider.list()` (the
// models.dev registry). The live API can differ from that registry (for example
// neuralwatt reports 25 models live but 21 in the registry). This module fetches
// the live model list per provider and merges the ids into the cached metadata,
// so the catalog MCP sees the full live set.

import { log } from "./logger"

export interface ModelMetadata {
  id: string
  provider?: string
  providerID?: string
  api?: { url?: string; [key: string]: unknown }
  [key: string]: unknown
}

export interface ProviderLike {
  id: string
  source?: string
  env?: string[]
  key?: string
  options?: Record<string, unknown>
  models?: Record<string, unknown>
}

export interface ProviderEndpoint {
  providerID: string
  baseURL: string
  apiKey: string
}

export interface LiveRefreshDeps {
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export interface LiveModelEntry {
  id: string
  contextLimit?: number
}

const DEFAULT_TIMEOUT_MS = 5000

function readModelApi(model: unknown): Record<string, unknown> | undefined {
  if (typeof model !== "object" || model === null) return undefined
  const api = (model as Record<string, unknown>).api
  return typeof api === "object" && api !== null ? (api as Record<string, unknown>) : undefined
}

function readApiUrl(model: unknown): string {
  const url = readModelApi(model)?.url
  return typeof url === "string" ? url : ""
}

function readApiNpm(model: unknown): string {
  const npm = readModelApi(model)?.npm
  return typeof npm === "string" ? npm : ""
}

function readOptionsString(options: Record<string, unknown> | undefined, key: string): string {
  if (!options) return ""
  const value = options[key]
  return typeof value === "string" ? value : ""
}

function resolveApiKey(provider: ProviderLike): string {
  if (typeof provider.key === "string" && provider.key.length > 0) return provider.key
  const fromOptions = readOptionsString(provider.options, "apiKey")
  if (fromOptions.length > 0) return fromOptions
  const envVar = provider.env?.[0]
  if (typeof envVar === "string" && envVar.length > 0) {
    const fromEnv = process.env[envVar]
    if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv
  }
  return ""
}

/**
 * Produce one endpoint per provider that is openai-compatible (any model has an
 * `api.npm` containing `openai-compatible` or a string `api.url`), exposes a
 * baseURL, and has a resolvable API key.
 */
export function extractProviderEndpoints(providers: ProviderLike[]): ProviderEndpoint[] {
  const endpoints: ProviderEndpoint[] = []
  for (const provider of providers) {
    if (!provider || typeof provider.id !== "string") continue
    const modelValues = Object.values(provider.models ?? {})
    const compatibleModel =
      modelValues.find((model) => readApiNpm(model).includes("openai-compatible")) ??
      modelValues.find((model) => readApiUrl(model).length > 0)
    if (!compatibleModel) continue

    const baseURL = readApiUrl(compatibleModel) || readOptionsString(provider.options, "baseURL")
    if (!baseURL) continue

    const apiKey = resolveApiKey(provider)
    if (!apiKey) continue

    endpoints.push({ providerID: provider.id, baseURL, apiKey })
  }
  return endpoints
}

function extractLiveModels(payload: unknown): LiveModelEntry[] | null {
  if (Array.isArray(payload)) return extractEntriesFromArray(payload)

  if (typeof payload === "object" && payload !== null) {
    const record = payload as Record<string, unknown>
    if (Array.isArray(record.data)) return extractEntriesFromArray(record.data)
    if (Array.isArray(record.models)) return extractEntriesFromArray(record.models)
  }

  return null
}

function readPositiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined
}

// OpenAI-compatible gateways publish the serving context under different keys
// (vLLM: max_model_len, EVREN portal schema: context_length).
function readLiveContextLimit(item: Record<string, unknown>): number | undefined {
  return (
    readPositiveInt(item.context_length) ??
    readPositiveInt(item.max_model_len) ??
    readPositiveInt(item.context_window)
  )
}

function extractEntriesFromArray(items: unknown[]): LiveModelEntry[] | null {
  const entries: LiveModelEntry[] = []
  for (const item of items) {
    if (typeof item === "string" && item.length > 0) {
      entries.push({ id: item })
    } else if (typeof item === "object" && item !== null) {
      const record = item as Record<string, unknown>
      const id = record.id
      if (typeof id === "string" && id.length > 0) {
        const contextLimit = readLiveContextLimit(record)
        entries.push(contextLimit === undefined ? { id } : { id, contextLimit })
      }
    }
  }
  return entries.length > 0 ? entries : null
}

/**
 * GET `${baseURL}/models` with a bearer token and return the live model
 * entries (id + context limit when the gateway reports one), or null on
 * timeout / non-2xx / parse failure / empty list. Never throws.
 */
export async function fetchLiveProviderModels(
  endpoint: ProviderEndpoint,
  deps?: LiveRefreshDeps,
): Promise<LiveModelEntry[] | null> {
  const fetchImpl = deps?.fetchImpl ?? fetch
  const timeoutMs = deps?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = `${endpoint.baseURL.replace(/\/+$/, "")}/models`
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${endpoint.apiKey}` },
      signal: controller.signal,
    })
    if (!response.ok) return null
    const payload: unknown = await response.json()
    return extractLiveModels(payload)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export const LIVE_MODEL_LIMIT_SOURCE = "gateway-live-models"

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function withoutStaleLiveMarker(entry: ModelMetadata): ModelMetadata {
  if (entry.limitSource === undefined) return entry
  const stripped: ModelMetadata = { ...entry }
  delete stripped.limitSource
  return stripped
}

function withLiveContext(entry: ModelMetadata, context: number): ModelMetadata {
  const base = withoutStaleLiveMarker(entry)
  const limit = asRecord(base.limit) ?? {}
  return { ...base, limit: { ...limit, context }, limitSource: LIVE_MODEL_LIMIT_SOURCE }
}

/**
 * Reconcile a provider's cached model metadata against the live model list:
 * keep previous entries still returned live (preserving metadata), overlay the
 * gateway-reported context limit (marked with `limitSource` so config injection
 * can trust it as the real serving limit), append minimal entries for new ids,
 * and drop ids no longer returned live. Returns `previous` unchanged when the
 * live list is empty.
 */
export function mergeLiveProviderModels(
  previous: ModelMetadata[],
  liveModels: LiveModelEntry[],
  providerID: string,
  baseURL: string,
): ModelMetadata[] {
  if (liveModels.length === 0) return previous

  const liveById = new Map<string, LiveModelEntry>()
  for (const model of liveModels) {
    if (model && typeof model.id === "string" && model.id.length > 0) {
      liveById.set(model.id, model)
    }
  }

  const merged: ModelMetadata[] = []
  for (const entry of previous) {
    if (!entry || typeof entry.id !== "string") continue
    const live = liveById.get(entry.id)
    if (!live) continue
    merged.push(
      live.contextLimit === undefined
        ? withoutStaleLiveMarker(entry)
        : withLiveContext(entry, live.contextLimit),
    )
  }

  const keptIds = new Set(merged.map((entry) => entry.id))
  for (const model of liveModels) {
    if (!model || typeof model.id !== "string" || model.id.length === 0) continue
    if (keptIds.has(model.id)) continue
    const fresh: ModelMetadata = { id: model.id, providerID, api: { url: baseURL } }
    if (model.contextLimit !== undefined) {
      fresh.limit = { context: model.contextLimit }
      fresh.limitSource = LIVE_MODEL_LIMIT_SOURCE
    }
    merged.push(fresh)
    keptIds.add(model.id)
  }

  return merged
}

function normalizeModelEntries(entries: ModelMetadata[] | string[] | undefined): ModelMetadata[] {
  if (!entries) return []
  return entries.map((entry) => (typeof entry === "string" ? { id: entry } : entry))
}

/**
 * Orchestrate endpoint extraction, parallel live fetches, and per-provider merge.
 * Best-effort: on any per-provider failure the provider's previous models are
 * kept. Overall bounded by the per-fetch timeout because fetches run in parallel.
 */
export async function refreshProviderModelsLive(
  providers: ProviderLike[],
  previousModels: Record<string, ModelMetadata[] | string[]>,
  deps?: LiveRefreshDeps,
): Promise<Record<string, ModelMetadata[]>> {
  const result: Record<string, ModelMetadata[]> = {}
  for (const [providerID, entries] of Object.entries(previousModels)) {
    result[providerID] = normalizeModelEntries(entries)
  }

  const endpoints = extractProviderEndpoints(providers)
  if (endpoints.length === 0) {
    return result
  }

  const fetched = await Promise.all(
    endpoints.map(async (endpoint) => ({
      endpoint,
      models: await fetchLiveProviderModels(endpoint, deps),
    })),
  )

  for (const { endpoint, models } of fetched) {
    if (!models || models.length === 0) continue
    const previous = result[endpoint.providerID] ?? []
    result[endpoint.providerID] = mergeLiveProviderModels(previous, models, endpoint.providerID, endpoint.baseURL)
  }

  log("[provider-model-live-refresh] Live model refresh complete", {
    endpoints: endpoints.length,
    providers: Object.keys(result),
  })

  return result
}
