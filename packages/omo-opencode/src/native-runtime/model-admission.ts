import type { JobClassificationBatch } from "../native-catalog/job-classification-codec"
import type { SessionInfo } from "@opencode/client"
import { connectedNativeProviders, createNativeControlStores, resolveNativeCatalogHealthDirectory, type NativeCatalogAdapter, type NativeCatalogContext } from "../native-catalog"
import type { NativeJevRequest } from "../native-routing"
import { createProviderHealthStore } from "../shared/provider-health"
import { isProviderDisabled } from "../shared/provider-toggles"
import { isModelAllowed } from "../shared/model-pool"

export function createNativeModelAdmission(input: {
  context: NativeCatalogContext
  homeDirectory: string
  catalog: NativeCatalogAdapter
  managerProviderID: string
  reject: (message: string) => never
}) {
  const controls = createNativeControlStores(input.homeDirectory)
  const health = createProviderHealthStore(() => resolveNativeCatalogHealthDirectory(input.homeDirectory))

  async function assertManagerProvider(): Promise<ReadonlySet<string>> {
    const current = await connectedNativeProviders({ context: input.context, toggles: controls.readProviderToggles, health: health.readProviderHealth, now: Date.now })
    if (!current.providers.some((provider) => provider.id === input.managerProviderID)) {
      input.reject(`Jev provider ${input.managerProviderID} is unavailable: ${current.unavailable[input.managerProviderID]?.reason ?? "not registered"}`)
    }
    return new Set(current.providers.map((provider) => provider.id))
  }

  async function beforeRoutingRequest(request: NativeJevRequest): Promise<void> {
    const current = await input.catalog.catalog.listAvailable()
    const allowed = new Set(current.filter((model) => model.available).map((model) => `${model.providerID}/${model.id}`))
    // The manager is a separate provider from the worker pool. Check it last,
    // after any asynchronous catalog reconciliation, for every HTTP attempt.
    const providers = await assertManagerProvider()
    const pool = controls.readPool()
    for (const candidate of request.candidates) {
      if (!allowed.has(`${candidate.model.providerID}/${candidate.model.id}`) || !providers.has(candidate.model.providerID)
        || !isModelAllowed(pool, candidate.model.providerID, candidate.model.id)
        || !input.catalog.pool.isAllowed(candidate.model)
        || (candidate.role === "advisor" && !input.catalog.pool.isConsultationAllowed(candidate.model))) input.reject("Native catalog eligibility changed before the Jev request")
    }
  }

  async function beforeModelRequest(session: SessionInfo): Promise<void> {
    if (!session.model) input.reject("Native session has no model assignment")
    const model = { providerID: session.model.providerID, id: session.model.id }
    const current = await input.catalog.catalog.listAvailable()
    const providers = await connectedNativeProviders({ context: input.context, toggles: controls.readProviderToggles, health: health.readProviderHealth, now: Date.now })
    if (!current.some((item) => item.available && item.providerID === model.providerID && item.id === model.id)) input.reject("Native session model is no longer available")
    // The root model is the user's /models selection; the pool governs children.
    if (session.parentID !== undefined && (!input.catalog.pool.isAllowed(model)
      || (session.agent === "momo-advisor" && !input.catalog.pool.isConsultationAllowed(model)))) input.reject("Native child model is no longer in its allowed pool")
    if (!providers.providers.some((provider) => provider.id === model.providerID && provider.activation !== "disabled")) input.reject("Native session provider is no longer available")
    const blocked = health.readProviderHealth()[model.providerID.trim().toLowerCase()]
    if (isProviderDisabled(controls.readProviderToggles(), model.providerID) || (blocked && Date.now() < blocked.unavailableUntil)) input.reject("Native provider became unavailable before execution")
    if (session.parentID !== undefined && !isModelAllowed(controls.readPool(), model.providerID, model.id)) input.reject("Native child model left the allowed pool before execution")
  }

  async function beforeClassificationRequest(batch: JobClassificationBatch): Promise<void> {
    const available = await input.catalog.catalog.listAvailable()
    const providers = await assertManagerProvider()
    const pool = controls.readPool()
    for (const { input: entry } of batch.entries) {
      const model = entry.model
      if (!providers.has(model.providerID) || !available.some(row => row.available && row.providerID === model.providerID && row.id === model.id)
        || !isModelAllowed(pool, model.providerID, model.id) || !input.catalog.pool.isAllowed(model)) input.reject("Classification model eligibility changed before the Jev request")
    }
  }

  function revision(): string {
    const snapshot = input.catalog.snapshot()
    return JSON.stringify({ pool: controls.readPool(), toggles: controls.readProviderToggles(), health: health.readProviderHealth(),
      providers: snapshot.connectedProviders, unavailable: snapshot.unavailableProviders,
      models: snapshot.models.map(model => [model.providerID, model.id, model.available]) })
  }

  return { assertManagerProvider, beforeRoutingRequest, beforeClassificationRequest, beforeModelRequest, revision }
}
