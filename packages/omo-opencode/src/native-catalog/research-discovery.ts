import type { NativeKnowledgeFact, NativeResearchContext } from "../native-routing/types"
import type { NativeCatalogModelFacts } from "./types"
import { hasUsableModelKnowledge } from "./knowledge-facts"

export interface NativeResearchDiscoveryStatus {
  readonly scanned: number
  readonly known: number
  readonly unknown: number
  readonly enqueued: number
  readonly contextUnavailable: boolean
}

export function createNativeResearchDiscovery(options: {
  listModels(): Promise<readonly NativeCatalogModelFacts[]> | readonly NativeCatalogModelFacts[]
  isAllowed(model: NativeCatalogModelFacts): Promise<boolean> | boolean
  knowledge(model: NativeCatalogModelFacts): Promise<NativeKnowledgeFact | undefined> | NativeKnowledgeFact | undefined
  enqueue(model: NativeCatalogModelFacts, context: NativeResearchContext): Promise<void> | void
  context(): Promise<NativeResearchContext | undefined>
}) {
  let discovering: Promise<NativeResearchDiscoveryStatus> | undefined
  async function scan(): Promise<NativeResearchDiscoveryStatus> {
    const unknown: NativeCatalogModelFacts[] = []
    const seen = new Set<string>()
    let known = 0
    for (const model of await options.listModels()) {
      const key = JSON.stringify([model.providerID, model.id])
      if (seen.has(key) || !model.available || !await options.isAllowed(model)) continue
      seen.add(key)
      const fact = await options.knowledge(model)
      if (hasUsableModelKnowledge(fact)) known++
      else unknown.push(model)
    }
    const status = { scanned: known + unknown.length, known, unknown: unknown.length, enqueued: 0, contextUnavailable: false }
    if (unknown.length === 0) return status
    const context = await options.context()
    if (!context) return { ...status, contextUnavailable: true }
    // The durable queue owns restart deduplication, dispatch concurrency and retries.
    for (const model of unknown) await options.enqueue(model, context)
    return { ...status, enqueued: unknown.length }
  }
  return {
    discover(): Promise<NativeResearchDiscoveryStatus> {
      discovering ??= scan().finally(() => { discovering = undefined })
      return discovering
    },
  }
}


/** Automatic background work must not rely on endpoint-unbound legacy price claims. */
export function isAutomaticResearchExecutor(model: NativeCatalogModelFacts): boolean {
  return model.available && model.toolCall === true && model.priceSource === "models.dev" &&
    model.priceCurrency === "USD" && model.priceOrigin === "https://models.dev/api.json" &&
    model.inputPricePerMillion === 0 && model.outputPricePerMillion === 0
}
