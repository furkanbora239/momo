// MODIFIED: momo assembles cached job classification and task routing around one paid-call owner.
import { join } from "node:path"
import { NativeJevAdmissionError, type JevClientDeps } from "@oh-my-opencode/decision-core"
import type { ManagerConfig } from "../config/schema/decision-engine"
import type { NativeCatalogAdapter } from "../native-catalog/adapter"
import { createJobClassDefinitions } from "../native-catalog/job-class-definitions"
import { jobClassificationFingerprint } from "../native-catalog/job-classification-identity"
import { hasUsableModelKnowledge } from "../native-catalog"
import { jobClassificationInput } from "../native-catalog/job-classification-input"
import type { JobClassificationBatch } from "../native-catalog/job-classification-codec"
import type { JobClassificationInput } from "../native-catalog/job-classification-types"
import { createNativeJevAccountant } from "../native-routing/jev-accountant"
import { createJobClassJevBackend } from "../native-routing/job-class-backend"
import type { NativeJevRequest, NativeModelRef, NativeRouterStore } from "../native-routing/types"
import { createNativeJobClassifier } from "./job-classifier"
import { homeRoot, projectNativeRoot } from "./user-data-paths"

export interface CatalogJobRoutingOptions {
  readonly directory: string
  readonly dataRoot?: string
  readonly profileCacheDirectory?: string
  readonly catalog: Pick<NativeCatalogAdapter, "catalog" | "pool" | "knowledge" | "snapshot">
  readonly routerStore: NativeRouterStore
  readonly managerConfig: ManagerConfig
  readonly waitForKnowledge?: boolean
  readonly classes?: unknown
  readonly getApiKey: JevClientDeps["getApiKey"]
  readonly beforeRoutingRequest: (request: NativeJevRequest) => Promise<void> | void
  readonly beforeClassificationRequest: (batch: JobClassificationBatch) => Promise<void> | void
  readonly revision: () => string
  readonly onError?: (error: unknown) => void
}
const sameModel = (left: NativeModelRef, right: NativeModelRef) => left.providerID === right.providerID && left.id === right.id

export function createCatalogJobRouting(options: CatalogJobRoutingOptions) {
  const catalog = options.catalog, config = options.managerConfig.jev
  const definitions = createJobClassDefinitions(options.classes)
  const accountant = createNativeJevAccountant({ store: options.routerStore, monthlyBudgetUsd: config.budget.monthly_cap_usd })
  const transport: JevClientDeps = { session: "momo-native-catalog", getApiKey: options.getApiKey,
    baseUrl: config.base_url, model: config.model, maxAttempts: config.max_attempts }
  async function getInputs(): Promise<readonly JobClassificationInput[]> {
    const models = await catalog.catalog.listAvailable(), inputs: JobClassificationInput[] = []
    for (const model of models) {
      if (!model.available || !await catalog.pool.isAllowed(model)) continue
      const knowledge = await catalog.knowledge.get(model)
      if (options.waitForKnowledge && !hasUsableModelKnowledge(knowledge)) continue
      inputs.push(jobClassificationInput(model, knowledge))
    }
    return inputs
  }
  function currentInput(model: NativeModelRef): JobClassificationInput | undefined {
    const facts = catalog.snapshot().models.find(row => sameModel(row, model))
    if (!facts?.available) return undefined
    const knowledge = catalog.knowledge.get(model)
    // The concrete native adapter reads knowledge synchronously. An unexpected
    // asynchronous implementation cannot provide a trusted synchronous cache view.
    if (knowledge instanceof Promise || options.waitForKnowledge && !hasUsableModelKnowledge(knowledge)) return undefined
    return jobClassificationInput(facts, knowledge)
  }
  async function isEligible(input: JobClassificationInput): Promise<boolean> {
    const models = await catalog.catalog.listAvailable()
    return models.some(model => model.available && sameModel(model, input.model)) && await catalog.pool.isAllowed(input.model)
  }
  const classifier = createNativeJobClassifier({
    directory: options.dataRoot ?? projectNativeRoot(options.directory), accountant, jev: transport,
    profileCacheDirectory: options.profileCacheDirectory ?? join(homeRoot(), ".omo", "native", "job-classifications"),
    definitions: () => definitions, getInputs, currentInput, isEligible, revision: options.revision, onError: options.onError,
    async assertBatchEligible(batch) {
      const models = await catalog.catalog.listAvailable()
      for (const entry of batch.entries) {
        if (!models.some(model => model.available && sameModel(model, entry.input.model)) || !await catalog.pool.isAllowed(entry.input.model)) {
          throw new NativeJevAdmissionError("Classification batch model is no longer available in the active model pool")
        }
      }
      // The runtime owner rechecks native manager/provider controls immediately
      // before every HTTP attempt, including client retries.
      await options.beforeClassificationRequest(batch)
      for (const entry of batch.entries) {
        const current = currentInput(entry.input.model)
        if (!current || jobClassificationFingerprint(definitions, current) !== entry.fingerprint) {
          throw new NativeJevAdmissionError("Classification source facts changed before the Jev request")
        }
      }
    },
  })
  const jev = createJobClassJevBackend({ ...transport, session: "momo-native-routing", beforeRequest: options.beforeRoutingRequest }, {
    definitions, confidenceThreshold: config.confidence_threshold, prepare: classifier.prepare,
    readClassMembership: classifier.memberships,
  })
  return { jev, accountant, classifier }
}
