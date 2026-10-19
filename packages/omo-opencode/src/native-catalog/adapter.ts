import type { ModelInfo, ProviderInfo } from "@opencode/client"
import { join } from "node:path"
import { createNativeLedgerOutcomeReader } from "../native-routing/outcome-reader"
import type { NativeCatalog, NativeKnowledge, NativeModelRef, NativeOutcomeStore, NativePool } from "../native-routing/types"
import { isModelAllowed } from "../shared/model-pool"
import { isProviderDisabled } from "../shared/provider-toggles"
import { createProviderHealthStore } from "../shared/provider-health"
import { createNativeControlStores } from "./native-control-stores"
import { fetchNativeLiveModels, type NativeLiveModel, type NativeLiveModelsResult } from "./live-models"
import { nativeModelFacts, resolveNativePriceSource } from "./model-facts"
import { hasVerifiedKnowledgeSource } from "./knowledge-facts"
import { createNativeCatalogKnowledgeStore } from "./knowledge-store"
import { resolveNativeCatalogHealthDirectory, resolveNativeOmoDirectory } from "./paths"
import { isOfficialPublicProvider } from "./public-provider"
import { connectedNativeProviders } from "./provider-admission"
import type { NativeCatalogAdapterOptions, NativeCatalogModelFacts, NativeCatalogSnapshot } from "./types"

export function createNativeCatalogAdapter(options: NativeCatalogAdapterOptions) {
  const now = options.now ?? Date.now
  const omoDirectory = resolveNativeOmoDirectory(options.homeDirectory)
  const controlStores = createNativeControlStores(options.homeDirectory)
  const healthStore = createProviderHealthStore(() => resolveNativeCatalogHealthDirectory(options.homeDirectory))
  const knowledgeStore = options.knowledgeStore ?? createNativeCatalogKnowledgeStore(join(omoDirectory, "native", "catalog-knowledge.json"))
  const markUnavailable = options.markProviderUnavailable ?? healthStore.markProviderUnavailable
  let snapshotValue: NativeCatalogSnapshot = {
    fetchedAt: "", connectedProviders: [], models: [], sources: {}, transportModelIDs: {}, unregisteredLiveModels: {}, unavailableProviders: {},
  }
  let advisorModels = new Set((options.advisorModels ?? []).map((model) => `${model.providerID}/${model.id}`))
  let refreshPromise: Promise<NativeCatalogSnapshot> | undefined
  let refreshGeneration = 0
  let pendingGeneration = 0

  async function refreshSnapshot(): Promise<NativeCatalogSnapshot> {
    const [providerResponse, modelResponse] = await Promise.all([options.context.provider.list(), options.context.model.list()])
    const providers = providerResponse.data
    const models = modelResponse.data
    const publishedModels = await options.readPublishedModels?.(models, providers) ?? new Map()
    const publicModels = models.filter((model) => {
      const published = publishedModels.get(`${model.providerID}/${model.id}`)
      const provider = providers.find((item) => item.id === model.providerID)
      return provider !== undefined && isOfficialPublicProvider(provider, model) && published?.inputPricePerMillion === 0 && published.outputPricePerMillion === 0
    }).map((model) => ({ providerID: model.providerID, id: model.id }))
    const publicKeys = new Set(publicModels.map((model) => `${model.providerID}/${model.id}`))
    const publicOnlyProviders = new Set<string>()
    const toggles = options.readToggles?.() ?? controlStores.readProviderToggles()
    const health = options.readHealth?.() ?? healthStore.readProviderHealth()
    const unavailableProviders: Record<string, { reason: string; until?: number; statusCode?: number }> = {}
    const configuredProviders = providers.filter((provider) => {
      const providerHealth = health[provider.id.trim().toLowerCase()]
      if (provider.activation === "disabled" || isProviderDisabled(toggles, provider.id)) {
        unavailableProviders[provider.id] = { reason: provider.activation === "disabled" ? "disabled in OpenCode provider settings" : "disabled by provider toggle" }
        return false
      }
      if (providerHealth && now() < providerHealth.unavailableUntil) {
        unavailableProviders[provider.id] = { reason: providerHealth.reason, until: providerHealth.unavailableUntil }
        return false
      }
      return true
    })
    const connectionStates = await Promise.all(configuredProviders.map(async (provider) => {
      if (!provider.integrationID) return { provider, connected: true }
      const connected = await options.context.integration.connection.active(provider.integrationID)
      if (!connected && isOfficialPublicProvider(provider) && publicModels.some((model) => model.providerID === provider.id)) {
        publicOnlyProviders.add(provider.id)
        return { provider, connected: true }
      }
      if (!connected) unavailableProviders[provider.id] = { reason: "no active OpenCode integration connection" }
      return { provider, connected: connected !== undefined }
    }))
    const activeProviders = connectionStates.filter((item) => item.connected).map((item) => item.provider)
    const liveByProvider = new Map<string, NativeLiveModelsResult>()
    await Promise.all(activeProviders.map(async (provider) => {
      liveByProvider.set(provider.id, publicOnlyProviders.has(provider.id)
        ? { models: new Map(), authoritative: false }
        : await fetchNativeLiveModels(options, provider, models, markUnavailable))
    }))
    for (const [providerID, live] of liveByProvider) {
      if (live.unavailable) unavailableProviders[providerID] = { ...live.unavailable }
    }

    const eligibleIDs = new Set(activeProviders.map((provider) => provider.id))
    const facts: NativeCatalogModelFacts[] = []
    const unavailableModels: Record<string, { reason: string; until: number }> = {}
    const sources: Record<string, readonly string[]> = {}
    const transportModelIDs: Record<string, string> = {}
    const unregisteredLiveModels: Record<string, string[]> = {}
    for (const model of models) {
      if (!eligibleIDs.has(model.providerID) || !model.enabled || model.status === "deprecated") continue
      if (publicOnlyProviders.has(model.providerID) && !publicKeys.has(`${model.providerID}/${model.id}`)) continue
      const live = liveByProvider.get(model.providerID)
      if (live?.unavailable) continue
      const liveRecord = live?.models.get(model.modelID)
      if (live?.authoritative && !liveRecord) continue
      const modelRef = { providerID: model.providerID, id: model.id }
      const published = publishedModels.get(`${model.providerID}/${model.id}`)
      const metadataPrice = published?.inputPricePerMillion !== undefined && published.outputPricePerMillion !== undefined
        ? { inputPerMillion: published.inputPricePerMillion, outputPerMillion: published.outputPricePerMillion, source: published.source }
        : undefined
      const researchedPrice = knowledgeStore.readPrice(modelRef)
      const publishedPrice = researchedPrice ?? metadataPrice
      const price = researchedPrice ? { source: "provider" as const, verified: true }
        : metadataPrice ? { source: "models.dev" as const, verified: true } : resolveNativePriceSource(model, options)
      const fact = nativeModelFacts(model, price.source, price.verified, liveRecord?.contextLength, publishedPrice)
      const policy = await options.modelPolicyHealth?.get(modelRef)
      if (policy) unavailableModels[`${model.providerID}/${model.id}`] = { reason: policy.reason, until: policy.unavailableUntil }
      const enriched = published ? { ...fact, published } : fact
      facts.push(policy ? { ...enriched, available: false } : enriched)
      const key = `${model.providerID}/${model.id}`
      transportModelIDs[key] = model.modelID
      sources[key] = liveRecord === undefined
        ? ["opencode.provider.list", "opencode.model.list"]
        : ["opencode.provider.list", "opencode.model.list", "provider.GET /models"]
    }
    collectUnregisteredLiveModels(activeProviders, models, liveByProvider, unregisteredLiveModels)
    const maintenance = await options.readMaintenance?.()
    const snapshot: NativeCatalogSnapshot = {
      fetchedAt: new Date(now()).toISOString(),
      connectedProviders: activeProviders.filter((provider) => !liveByProvider.get(provider.id)?.unavailable).map((provider) => provider.id),
      models: facts,
      sources,
      transportModelIDs,
      unregisteredLiveModels,
      unavailableProviders,
      unavailableModels,
      ...(maintenance ? { maintenance: { queued: maintenance.filter((item) => item.status === "queued").length, paused: maintenance.filter((item) => item.status === "paused").length, running: maintenance.filter((item) => item.status === "running").length, completed: maintenance.filter((item) => item.status === "completed").length, failed: maintenance.filter((item) => item.status === "failed").length, pauseReasons: [...new Set(maintenance.filter((item) => item.status === "paused").map((item) => item.reason ?? "unknown"))] } } : {}),
    }
    return snapshot
  }

  function collectUnregisteredLiveModels(
    providers: readonly ProviderInfo[],
    models: readonly ModelInfo[],
    liveByProvider: ReadonlyMap<string, NativeLiveModelsResult>,
    result: Record<string, string[]>,
  ): void {
    for (const provider of providers) {
      const live = liveByProvider.get(provider.id)
      if (!live?.authoritative || live.unavailable) continue
      const knownIDs = new Set(models.filter((model) => model.providerID === provider.id).map((model) => model.modelID))
      const unknown = [...live.models.keys()].filter((modelID) => !knownIDs.has(modelID))
      if (unknown.length > 0) result[provider.id] = unknown
    }
  }

  async function refresh(): Promise<NativeCatalogSnapshot> {
    if (!refreshPromise) {
      pendingGeneration = ++refreshGeneration
      refreshPromise = refreshSnapshot()
    }
    const generation = pendingGeneration
    const pending = refreshPromise
    let snapshot: NativeCatalogSnapshot
    try {
      snapshot = await pending
    } finally {
      if (refreshPromise === pending) refreshPromise = undefined
    }
    const current = await connectedNativeProviders({
      context: options.context,
      toggles: () => options.readToggles?.() ?? controlStores.readProviderToggles(),
      health: () => options.readHealth?.() ?? healthStore.readProviderHealth(),
      now,
      publicModels: snapshot.models.filter((model) => model.inputPricePerMillion === 0 && model.outputPricePerMillion === 0),
    })
    const allowed = new Set(current.providers.map((provider) => provider.id))
    const filterKeys = <T>(records: Readonly<Record<string, T>>) => Object.fromEntries(Object.entries(records).filter(([key]) => allowed.has(key.split("/")[0])))
    const visible: NativeCatalogSnapshot = {
      ...snapshot,
      connectedProviders: snapshot.connectedProviders.filter((id) => allowed.has(id)),
      models: snapshot.models.filter((model) => allowed.has(model.providerID) && (!current.publicOnlyProviders.includes(model.providerID) || model.inputPricePerMillion === 0 && model.outputPricePerMillion === 0)),
      sources: filterKeys(snapshot.sources),
      transportModelIDs: filterKeys(snapshot.transportModelIDs),
      unregisteredLiveModels: filterKeys(snapshot.unregisteredLiveModels),
      unavailableProviders: { ...snapshot.unavailableProviders, ...current.unavailable },
    }
    if (generation === refreshGeneration) snapshotValue = visible
    return visible
  }

  const catalog: NativeCatalog = { listAvailable: async () => (await refresh()).models }
  const pool = {
    isAllowed(model) { return isModelAllowed(options.readPool?.() ?? controlStores.readPool(), model.providerID, model.id) },
    isConsultationAllowed(model) {
      return advisorModels.size > 0 && advisorModels.has(`${model.providerID}/${model.id}`) && isModelAllowed(options.readPool?.() ?? controlStores.readPool(), model.providerID, model.id)
    },
  } satisfies NativePool
  const knowledge: NativeKnowledge = {
    get(model) {
      const fromOption = options.readKnowledge?.(model)
      if (fromOption) return hasVerifiedKnowledgeSource(fromOption) ? fromOption : { ...fromOption, known: false }
      try {
        return knowledgeStore.read(model) ?? { model, known: false }
      } catch (error) {
        options.onError?.(`native catalog knowledge read failed for ${model.providerID}/${model.id}`, error)
        return { model, known: false }
      }
    },
    research: options.researchModel,
    researchFailed(model, error) { options.onError?.(`model knowledge research failed for ${model.providerID}/${model.id}`, error) },
  }
  const ledgerOutcomes = options.routerStore ? createNativeLedgerOutcomeReader(options.routerStore) : undefined
  const outcomes: NativeOutcomeStore = {
    list: () => options.listOutcomes?.() ?? ledgerOutcomes?.list() ?? [],
  }

  return {
    catalog,
    pool,
    knowledge,
    outcomes,
    refresh,
    async listProviderIDs() { return (await options.context.provider.list()).data.map((provider) => provider.id) },
    snapshot: () => snapshotValue,
    knowledgeStore,
    setAdvisorModels(models: readonly NativeModelRef[]) { advisorModels = new Set(models.map((model) => `${model.providerID}/${model.id}`)) },
  }
}

export type NativeCatalogAdapter = ReturnType<typeof createNativeCatalogAdapter>
