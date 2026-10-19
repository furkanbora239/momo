export type NativeRole =
  | "orchestrator"
  | "planner"
  | "executor"
  | "reviewer"
  | "worker"
  | "explore"
  | "librarian"
  | "research"
  | "catalog-researcher"
  | "advisor"

export type NativeTaskKind = "task" | "consultation"

export interface NativeModelRef {
  readonly providerID: string
  readonly id: string
}

export interface NativeRouteInput {
  /** Stable caller-supplied task identity for crash-safe, idempotent routing. */
  readonly decisionId?: string
  readonly prompt: string
  readonly scope?: string
  readonly acceptance?: string
  readonly parentRole: NativeRole | string
  readonly rootSessionID: string
  readonly parentSessionID: string
  readonly kind: NativeTaskKind
  /** Trusted internal role constraint, intersected with the caller's routing policy. */
  readonly sourceDecisionID?: string
  readonly requiredRole?: NativeRole
  readonly requiredContextLength?: number
  readonly requiredCapabilities?: readonly string[]
}

export interface NativePublishedModelMetadata {
  readonly source: string
  readonly name?: string
  readonly description?: string
  readonly family?: string
  readonly reasoning?: boolean
}

export interface NativeModelFacts extends NativeModelRef {
  readonly displayName?: string
  readonly family?: string
  readonly canonical?: string
  readonly published?: NativePublishedModelMetadata
  readonly available: boolean
  readonly priceSource?: "models.dev" | "opencode.model.list" | "provider" | "configuration" | "unknown"
  readonly priceCurrency?: "USD" | "unknown"
  readonly priceOrigin?: string
  readonly inputPricePerMillion?: number
  readonly outputPricePerMillion?: number
  readonly contextLength?: number
  readonly toolCall?: boolean
  readonly inputModalities?: readonly string[]
  readonly outputModalities?: readonly string[]
  readonly capabilities?: readonly string[]
}

export interface NativeKnowledgeFact {
  readonly model: NativeModelRef
  readonly known: boolean
  readonly summary?: string
  readonly strengths?: readonly string[]
  readonly limitations?: readonly string[]
  readonly source?: string
  readonly verifiedAt?: string
}

export interface NativeOutcomeFact {
  readonly model: NativeModelRef
  readonly role: NativeRole | string
  readonly taskKind: NativeTaskKind
  readonly result: "success" | "failure" | "timeout" | "unknown"
  readonly provenance: "runtime" | "operator" | "legacy-import"
  readonly durationMs?: number
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly taskId?: string
  readonly sessionId?: string
  readonly verification?: "unknown" | "tests" | "artifact"
}

export interface NativeResearchContext {
  readonly decisionId: string
  readonly rootSessionID: string
  readonly parentSessionID: string
  readonly parentRole: NativeRole | string
}

export interface NativeDispatchFact {
  readonly taskId: string
  readonly sessionId: string
  readonly role: NativeRole
  readonly model: NativeModelRef
}

export interface NativeCandidate {
  readonly role: NativeRole
  readonly model: NativeModelRef
  readonly probability?: number
  readonly rationale?: string
  readonly facts: NativeModelFacts
  readonly knowledge: NativeKnowledgeFact
}

export interface NativeRouteSelected {
  readonly kind: "selected"
  readonly decisionId: string
  readonly role: NativeRole
  readonly model: NativeModelRef
}

export interface NativeRouteAwaitingSelection {
  readonly kind: "awaiting_selection"
  readonly decisionId: string
  readonly reason: string
  readonly candidates: readonly NativeCandidate[]
}

export interface NativeRouteUnavailable {
  readonly kind: "unavailable"
  readonly decisionId?: string
  readonly reason: string
}

export type NativeRouteResult =
  | NativeRouteSelected
  | NativeRouteAwaitingSelection
  | NativeRouteUnavailable

export interface NativeJevRequest {
  readonly decisionId: string
  readonly input: NativeRouteInput
  readonly allowedRoles: readonly NativeRole[]
  readonly candidates: readonly NativeCandidate[]
  readonly knowledge: readonly NativeKnowledgeFact[]
  readonly outcomes: readonly NativeOutcomeFact[]
  readonly instructions: string
}

export interface NativeJevAnswer {
  readonly role: NativeRole | string
  readonly model: NativeModelRef
  readonly confidence: number
  readonly probabilities: Readonly<Record<string, number>>
  readonly rationale?: string
  readonly lane?: "direct" | "department"
  readonly laneConfidence?: number
  readonly source?: unknown
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly costUsd?: number }
}

export interface NativeJevBillingBinding {
  readonly model: string
  readonly endpoint: string
}

export interface NativeJev {
  readonly billingBinding?: NativeJevBillingBinding
  /** Catalog warmup runs before the routing paid-call queue is acquired. */
  prepare?(request: NativeJevRequest): Promise<void> | void
  choose(request: NativeJevRequest, audit?: NativeJevCallAudit): Promise<NativeJevAnswer>
}

export interface NativeJevCallAudit {
  beforeRequest(binding?: NativeJevBillingBinding): Promise<void> | void
  recordAttempt(attempt: NativeJevHttpAttempt): Promise<void> | void
}

export interface NativeJevCallRecord {
  readonly version: 1
  readonly type: "jev_call"
  readonly callId: string
  readonly purpose: "routing" | "classification"
  readonly inputDigest: string
  readonly billingBinding?: NativeJevBillingBinding
  readonly createdAt: string
  readonly status: "pending" | "complete" | "not_sent"
  readonly usage?: NativeJevAnswer["usage"]
}

export interface NativeJevHttpAttempt {
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly requestBody: unknown
  readonly status?: number
  readonly responseBody?: unknown
  readonly error?: string
}

export interface NativeCatalog {
  listAvailable(): Promise<readonly NativeModelFacts[]> | readonly NativeModelFacts[]
}

export interface NativePool {
  isAllowed(model: NativeModelRef): Promise<boolean> | boolean
  isConsultationAllowed?(model: NativeModelRef): Promise<boolean> | boolean
}

export interface NativeKnowledge {
  get(model: NativeModelRef): Promise<NativeKnowledgeFact | undefined> | NativeKnowledgeFact | undefined
  research?(model: NativeModelRef, context: NativeResearchContext): Promise<void> | void
  researchFailed?(model: NativeModelRef, error: unknown, context: NativeResearchContext): void
}

export interface NativeOutcomeStore {
  list(): Promise<readonly NativeOutcomeFact[]> | readonly NativeOutcomeFact[]
}

export interface NativeDecisionRecord {
  readonly version: 1
  readonly type: "decision"
  readonly decisionId: string
  readonly createdAt: string
  readonly request: NativeJevRequest
  readonly candidateSnapshots: readonly {
    readonly capturedAt: string
    readonly source: "initial" | "post-jev-revalidation" | "selection-revalidation"
    readonly candidates: readonly NativeCandidate[]
  }[]
  /** Provider-reported billing captured independently of semantic answer validity. */
  readonly jevUsage?: NativeJevAnswer["usage"]
  readonly jevCallId?: string
  readonly jevAttempted?: boolean
  readonly jevAnswer?: NativeJevAnswer
  readonly jevFailure?: { readonly message: string; readonly rawResponse?: unknown }
  readonly probabilities?: Readonly<Record<string, number>>
  readonly selected?: { readonly role: NativeRole; readonly model: NativeModelRef; readonly by: "jev" | "caller" | "runtime"; readonly taskId?: string; readonly sessionId?: string }
  readonly outcome?: NativeOutcomeFact
  readonly status: "awaiting_selection" | "selected" | "completed" | "unavailable"
  readonly choiceCandidates?: readonly NativeCandidate[]
  readonly reason?: string
}

export interface NativeBreakerRecord {
  readonly version: 1
  readonly type: "breaker"
  readonly consecutiveFailures: number
  readonly openUntil: number
}

export type NativeLedgerRecord = NativeDecisionRecord | NativeBreakerRecord | NativeJevCallRecord

export interface NativeRouterStore {
  load(): Promise<readonly NativeLedgerRecord[]>
  append(record: NativeLedgerRecord): Promise<void>
  exportLines(): Promise<readonly string[]>
}

export interface NativeRouterConfig {
  readonly confidenceThreshold?: number
  readonly breakerFailures?: number
  readonly breakerCooldownMs?: number
  readonly advisorModels?: readonly NativeModelRef[]
  readonly getAdvisorModels?: () => readonly NativeModelRef[]
  readonly monthlyBudgetUsd?: number
  readonly now?: () => number
  readonly createId?: () => string
}

export interface NativeRouterDeps {
  readonly accountant?: import("./jev-accountant").NativeJevAccountant
  readonly jev: NativeJev
  readonly catalog: NativeCatalog
  readonly pool: NativePool
  readonly knowledge: NativeKnowledge
  readonly outcomes: NativeOutcomeStore
  readonly store: NativeRouterStore
  readonly config?: NativeRouterConfig
  readonly onError?: (message: string, error: unknown) => void
}
