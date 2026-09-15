// provider-model-config-injection.ts — inject live-only provider models into
// OpenCode's provider config so they show up in `opencode models` and the
// `/models` picker.
//
// OpenCode builds its model list from the models.dev registry plus
// `config.provider.<id>.models`. A connected openai-compatible provider can
// serve models live that the registry does not declare; the provider-models
// cache (see provider-model-live-refresh.ts) already reconciles those ids, but
// only the catalog MCP consumed them. This module computes the ids that are
// live but neither declared by the registry nor already present in the user's
// config, and writes minimal config entries for them during the plugin config
// hook. It never overwrites, mutates, or drops an existing entry, and it never
// throws: a missing or malformed cache is a silent no-op.
//
// Trigger context: the provider-models cache is written ONLY by
// `updateAndShowConnectedProvidersCacheStatus` (connected-providers-status.ts)
// during a real session start. One-shot commands such as `opencode models` or
// `omo doctor` do not write it, so on a machine with no cache the config hook
// no-ops for that session and injection starts working from the next session.
// This is accepted by design; do not add network I/O on the config path.

import { log } from "./logger"
import type { ModelMetadata, ProviderModelsCache } from "./connected-providers-cache"
import { isModelAllowed, type ModelPool } from "./model-pool"

export interface ProviderModelConfigEntry {
  name?: string
  limit?: { context?: number; output?: number }
  reasoning?: boolean
  tool_call?: boolean
}

export interface LiveOnlyModelEntryInput {
  providerID: string
  existingConfigModels: Record<string, unknown>
  registryModelIds: readonly string[]
  liveModelIds: readonly string[]
  cachedMetadata?: readonly (ModelMetadata | string)[]
  pool?: ModelPool
}

export interface LiveModelConfigInjectorDeps {
  readProviderModelsCache: () => ProviderModelsCache | null
  readModelPool: () => ModelPool
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return value
}

function findCachedMetadata(
  cachedMetadata: readonly (ModelMetadata | string)[] | undefined,
  modelID: string,
): ModelMetadata | undefined {
  for (const entry of cachedMetadata ?? []) {
    if (typeof entry === "string") {
      if (entry === modelID) return { id: entry }
      continue
    }
    if (isRecord(entry) && entry.id === modelID) return entry
  }
  return undefined
}

function buildModelConfigEntry(
  modelID: string,
  metadata: ModelMetadata | undefined,
): ProviderModelConfigEntry {
  const entry: ProviderModelConfigEntry = {
    name: typeof metadata?.name === "string" && metadata.name.length > 0 ? metadata.name : modelID,
  }

  const limit: { context?: number; output?: number } = {}
  const context = readPositiveNumber(metadata?.limit?.context) ?? readPositiveNumber(metadata?.context)
  const output = readPositiveNumber(metadata?.limit?.output) ?? readPositiveNumber(metadata?.output)
  if (context !== undefined) limit.context = context
  if (output !== undefined) limit.output = output
  if (limit.context !== undefined || limit.output !== undefined) entry.limit = limit

  if (typeof metadata?.reasoning === "boolean") entry.reasoning = metadata.reasoning
  if (typeof metadata?.tool_call === "boolean") entry.tool_call = metadata.tool_call

  return entry
}

/**
 * Pure computation: return minimal config entries for model ids that are live
 * but neither declared by the registry nor already present in the provider's
 * existing config models. When a non-empty pool is given, only pool-allowed
 * ids are returned; an empty or absent pool allows everything.
 */
export function computeLiveOnlyModelConfigEntries(
  input: LiveOnlyModelEntryInput,
): Record<string, ProviderModelConfigEntry> {
  const entries: Record<string, ProviderModelConfigEntry> = {}
  if (input.providerID.length === 0) return entries

  const existing = new Set(Object.keys(input.existingConfigModels))
  const registry = new Set(input.registryModelIds)

  for (const modelID of input.liveModelIds) {
    if (typeof modelID !== "string" || modelID.length === 0) continue
    if (existing.has(modelID) || registry.has(modelID)) continue
    if (input.pool && !isModelAllowed(input.pool, input.providerID, modelID)) continue
    entries[modelID] = buildModelConfigEntry(modelID, findCachedMetadata(input.cachedMetadata, modelID))
  }

  return entries
}

function extractLiveModelIds(cache: ProviderModelsCache, providerID: string): string[] {
  const providerModels = cache.models?.[providerID]
  if (!Array.isArray(providerModels)) return []
  const ids: string[] = []
  for (const entry of providerModels) {
    if (typeof entry === "string" && entry.length > 0) {
      ids.push(entry)
    } else if (isRecord(entry) && typeof entry.id === "string" && entry.id.length > 0) {
      ids.push(entry.id)
    }
  }
  return ids
}

/**
 * Factory for the config-hook injection step. The returned function mutates
 * `config.provider[providerID].models` in place, adding ONLY missing live-only
 * ids. It never throws and never performs network I/O: everything comes from
 * the injected cache and pool readers.
 */
export function createLiveModelConfigInjector(deps: LiveModelConfigInjectorDeps) {
  return function injectLiveProviderModelsIntoConfig(config: Record<string, unknown>): void {
    try {
      const cache = deps.readProviderModelsCache()
      if (!isRecord(cache)) return

      const pool = deps.readModelPool()
      const providers = config.provider
      if (!isRecord(providers)) return

      const connected = Array.isArray(cache.connected) ? cache.connected : []
      const connectedSet = new Set(
        connected.filter((id): id is string => typeof id === "string" && id.length > 0),
      )
      const candidates = new Set<string>([
        ...connectedSet,
        ...Object.keys(providers),
      ])

      for (const providerID of candidates) {
        if (providerID.length === 0) continue
        const liveModelIds = extractLiveModelIds(cache, providerID)
        if (liveModelIds.length === 0) continue

        // Registry baseline gate: the cache must record which ids models.dev
        // declares for this provider. Caches written before `registryModels`
        // existed (or entries missing/empty for a provider) give no way to
        // tell live-only ids apart from registry ones, so guessing is not
        // allowed: skip the provider instead of injecting duplicates that
        // would shadow registry metadata.
        const registryModelIds = isRecord(cache.registryModels)
          ? cache.registryModels[providerID]
          : undefined
        if (!Array.isArray(registryModelIds) || registryModelIds.length === 0) {
          log("[provider-model-config-injection] Skipping provider: cache has no registry model baseline for it", {
            providerID,
            reason: isRecord(cache.registryModels) ? "missing-or-empty-registry-entry" : "cache-predates-registryModels",
          })
          continue
        }

        let providerConfig = isRecord(providers[providerID])
          ? (providers[providerID] as Record<string, unknown>)
          : undefined
        if (!providerConfig) {
          // Providers served from the models.dev registry are normally absent
          // from `config.provider` entirely. For connected providers, create a
          // minimal entry so live-only ids still reach `opencode models`; it
          // merges harmlessly with the registry-declared provider. An existing
          // but malformed entry is never overwritten.
          if (!connectedSet.has(providerID) || providers[providerID] !== undefined) continue
          providerConfig = { models: {} }
          providers[providerID] = providerConfig
        }

        const existingConfigModels = isRecord(providerConfig.models) ? providerConfig.models : {}

        const entries = computeLiveOnlyModelConfigEntries({
          providerID,
          existingConfigModels,
          registryModelIds,
          liveModelIds,
          cachedMetadata: cache.models?.[providerID],
          pool,
        })

        const injectedIDs = Object.keys(entries)
        if (injectedIDs.length === 0) continue

        const models = isRecord(providerConfig.models) ? providerConfig.models : (providerConfig.models = {})
        for (const [modelID, entry] of Object.entries(entries)) {
          models[modelID] = entry
        }

        log("[provider-model-config-injection] Injected live-only models into provider config", {
          providerID,
          modelIDs: injectedIDs,
        })
      }
    } catch (error) {
      log("[provider-model-config-injection] Injection failed, skipping", { error: String(error) })
    }
  }
}
