import type { Plugin } from "@opencode/plugin"
import type { NativeKnowledgeFact, NativeModelFacts, NativeModelRef, NativeOutcomeFact, NativeResearchContext, NativeRouterStore } from "../native-routing/types"
import type { ModelPool } from "../shared/model-pool"
import type { ProviderToggles } from "../shared/provider-toggles"
import type { ProviderHealthSnapshot } from "../shared/provider-health"
import type { NativeCatalogKnowledgeStore } from "./knowledge-store"

export type NativeCatalogContext = Pick<Plugin.Context, "provider" | "model" | "integration">

export interface NativeCatalogSnapshot {
  readonly maintenance?: { readonly queued: number; readonly paused: number; readonly running: number; readonly completed: number; readonly failed: number; readonly pauseReasons: readonly string[] }
  readonly unavailableModels?: Readonly<Record<string, { readonly reason: string; readonly until: number }>>
  readonly fetchedAt: string
  readonly connectedProviders: readonly string[]
  readonly models: readonly NativeCatalogModelFacts[]
  readonly sources: Readonly<Record<string, readonly string[]>>
  readonly transportModelIDs: Readonly<Record<string, string>>
  readonly unregisteredLiveModels: Readonly<Record<string, readonly string[]>>
  readonly unavailableProviders: Readonly<Record<string, { readonly reason: string; readonly until?: number; readonly statusCode?: number }>>
}

export interface NativeCatalogModelFacts extends NativeModelFacts {
  readonly published?: import("./published-models").NativePublishedModel
}

export interface NativeCatalogAdapterOptions {
  readonly readPublishedModels?: (models: readonly import("@opencode/client").ModelInfo[], providers: readonly import("@opencode/client").ProviderInfo[]) => Promise<ReadonlyMap<string, import("./published-models").NativePublishedModel>>
  readonly readMaintenance?: () => Promise<import("./research-maintenance").NativeResearchMaintenanceEntry[]>
  readonly modelPolicyHealth?: import("./model-policy-health").NativeModelPolicyHealth
  readonly context: NativeCatalogContext
  /** Home root for native data. `.omo` and managed cache paths are resolved beneath it. */
  readonly homeDirectory?: string
  readonly advisorModels?: readonly NativeModelRef[]
  readonly fetchImpl?: typeof fetch
  readonly now?: () => number
  readonly onError?: (message: string, error: unknown) => void
  readonly listOutcomes?: () => Promise<readonly NativeOutcomeFact[]> | readonly NativeOutcomeFact[]
  readonly routerStore?: Pick<NativeRouterStore, "load">
  readonly readKnowledge?: (model: NativeModelRef) => NativeKnowledgeFact | undefined
  readonly knowledgeStore?: NativeCatalogKnowledgeStore
  readonly researchModel?: (model: NativeModelRef, context: NativeResearchContext) => Promise<void> | void
  readonly readPool?: () => ModelPool
  readonly readToggles?: () => ProviderToggles
  readonly readHealth?: () => ProviderHealthSnapshot
  readonly markProviderUnavailable?: (providerID: string, input: { readonly reason: string; readonly statusCode?: number }) => void
  readonly priceProvenance?: (model: import("@opencode/client").ModelInfo) => "models.dev" | "opencode.model.list" | "provider" | "configuration" | "unknown"
}
