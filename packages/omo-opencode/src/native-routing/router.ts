import { jevUsage, legacyJevBilling } from "./jev-usage"
import { randomUUID } from "node:crypto"
import type {
  NativeCandidate,
  NativeDispatchFact,
  NativeDecisionRecord,
  NativeJevAnswer,
  NativeJevRequest,
  NativeModelFacts,
  NativeModelRef,
  NativeOutcomeFact,
  NativeResearchContext,
  NativeRole,
  NativeRouteInput,
  NativeRouteResult,
  NativeRouterDeps,
} from "./types"
import { candidateFrom, rankUncertainCandidates, refKey, sameModel } from "./candidate-ranking"
import { isJevAnswer } from "./jev-answer-validation"
import { nativeJevFailureAdmission, nativeJevFailureEvidence, nativeJevFailureNotSent } from "./jev-adapter"
import { allowedRoles, validateInput } from "./role-policy"

export function createNativeRouter(deps: NativeRouterDeps) {
  const config = deps.config ?? {}
  const threshold = config.confidenceThreshold ?? 0.75
  const breakerLimit = config.breakerFailures ?? 3
  const breakerCooldownMs = config.breakerCooldownMs ?? 600_000
  const now = config.now ?? Date.now
  const createId = config.createId ?? randomUUID
  let loaded = false
  let loadPromise: Promise<void> | undefined
  let consecutiveFailures = 0
  let openUntil = 0
  let jevReservedSpend = 0
  let jevSpendUnknown = false
  const researchQueued = new Map<string, Promise<void>>()
  const byDecision = new Map<string, NativeDecisionRecord>()
  const inflightRoutes = new Map<string, { input: NativeRouteInput; promise: Promise<NativeRouteResult> }>()
  let mutationQueue = Promise.resolve()
  let jevQueue = Promise.resolve()

  function advisorModels(): readonly NativeModelRef[] {
    return config.getAdvisorModels?.() ?? config.advisorModels ?? []
  }

  const exclusive = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = mutationQueue.then(operation, operation)
    mutationQueue = next.then(() => undefined, () => undefined)
    return next
  }

  const serialJev = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = jevQueue.then(operation, operation)
    jevQueue = next.then(() => undefined, () => undefined)
    return next
  }

  function ensureLoaded(): Promise<void> {
    if (loaded) return Promise.resolve()
    if (!loadPromise) {
      loadPromise = deps.store.load().then((loadedRecords) => {
        for (const record of loadedRecords) {
          if (record.type === "decision") byDecision.set(record.decisionId, record)
          else if (record.type === "breaker") {
            consecutiveFailures = record.consecutiveFailures
            openUntil = record.openUntil
          }
        }
        const monthStart = new Date(now())
        monthStart.setUTCDate(1)
        monthStart.setUTCHours(0, 0, 0, 0)
        for (const record of byDecision.values()) {
          if (record.createdAt < monthStart.toISOString()) continue
          const legacy = legacyJevBilling(record.jevFailure?.rawResponse)
          const usage = record.jevUsage ?? record.jevAnswer?.usage ?? legacy.usage
          if ((record.jevAttempted || record.jevAnswer || legacy.attempted) && usage?.costUsd === undefined) jevSpendUnknown = true
          jevReservedSpend += usage?.costUsd ?? 0
        }
        loaded = true
      }).catch((error) => {
        loadPromise = undefined
        throw error
      })
    }
    return loadPromise
  }

  async function persistBreaker(): Promise<void> {
    const breaker = { version: 1 as const, type: "breaker" as const, consecutiveFailures, openUntil }
    await deps.store.append(breaker)
  }

  async function snapshot(input: NativeRouteInput): Promise<NativeCandidate[]> {
    const roles = allowedRoles(input)
    const advisorConsultation = input.kind === "consultation"
    if (advisorConsultation && advisorModels().length === 0) return []
    const catalogFacts = await deps.catalog.listAvailable()
    const permitted: NativeModelFacts[] = []
    for (const facts of catalogFacts) {
      if (!facts.available || !await deps.pool.isAllowed(facts)) continue
      if (facts.toolCall === false) continue
      if (input.requiredContextLength !== undefined && facts.contextLength !== undefined && facts.contextLength < input.requiredContextLength) continue
      if (input.requiredContextLength !== undefined && facts.contextLength === undefined) continue
      if (input.requiredCapabilities?.some((capability) => !facts.capabilities?.includes(capability))) continue
      if (advisorConsultation) {
        if (!advisorModels().some((model) => sameModel(model, facts))) continue
        if (deps.pool.isConsultationAllowed && !await deps.pool.isConsultationAllowed(facts)) continue
      }
      permitted.push(facts)
    }
    const candidates: NativeCandidate[] = []
    for (const facts of permitted) {
      const knowledge = await deps.knowledge.get(facts)
      const explicitKnowledge = knowledge ?? { model: { providerID: facts.providerID, id: facts.id }, known: false }
      for (const role of roles) candidates.push(candidateFrom(facts, role, explicitKnowledge))
    }
    return candidates
  }

  function queueResearch(model: NativeModelRef, context: NativeResearchContext): Promise<void> {
    const key = refKey(model)
    const pending = researchQueued.get(key)
    if (pending) return pending
    if (!deps.knowledge.research) return Promise.resolve()
    const queued = Promise.resolve()
      .then(() => deps.knowledge.research?.(model, context))
      .catch((error) => {
        researchQueued.delete(key)
        if (deps.knowledge.researchFailed) deps.knowledge.researchFailed(model, error, context)
        else if (deps.onError) deps.onError(`knowledge research failed for ${key}`, error)
        else console.error(`[native-routing] knowledge research failed for ${key}`, error)
      })
    researchQueued.set(key, queued)
    return queued
  }

  async function recoverResearch(): Promise<void> {
    await ensureLoaded()
    for (const record of byDecision.values()) {
      if (!record.selected?.taskId || !record.selected.sessionId || record.selected.role === "catalog-researcher") continue
      const model = record.selected.model
      if ((await deps.knowledge.get(model))?.known) continue
      const { rootSessionID, parentSessionID, parentRole } = record.request.input
      await queueResearch(model, { decisionId: record.decisionId, rootSessionID, parentSessionID, parentRole })
    }
  }

  function requestFor(input: NativeRouteInput, decisionId: string, candidates: readonly NativeCandidate[], outcomes: readonly NativeOutcomeFact[]): NativeJevRequest {
    const knownFacts = new Map<string, NativeCandidate["knowledge"]>()
    for (const candidate of candidates) knownFacts.set(refKey(candidate.model), candidate.knowledge)
    return {
      decisionId,
      input,
      allowedRoles: allowedRoles(input),
      candidates,
      knowledge: [...knownFacts.values()],
      outcomes,
      instructions: "Choose the least expensive model that is demonstrably adequate for the full task. Consider all connected candidates: free models for trivial work, retain sufficiently capable premium options. Unknown prices are unknown, never free. Unknown abilities are unverified. Respect task-vs-consultation kind and role/depth constraints. Select lane=department only when a planner, executor, or reviewer lead should coordinate worker children; otherwise use direct. Candidate keys are role|providerID/modelID. Return probabilities over plausible candidate keys.",
    }
  }

  function makeRecord(request: ReturnType<typeof requestFor>, status: NativeDecisionRecord["status"], reason?: string, answer?: NativeJevAnswer, probabilities?: Readonly<Record<string, number>>): NativeDecisionRecord {
    const capturedAt = new Date(now()).toISOString()
    return {
      version: 1,
      type: "decision",
      decisionId: request.decisionId,
      createdAt: capturedAt,
      request,
      candidateSnapshots: [{ capturedAt, source: "initial", candidates: request.candidates }],
      jevAnswer: answer,
      jevAttempted: answer ? true : undefined,
      jevUsage: answer?.usage,
      probabilities,
      status,
      reason,
    }
  }

  async function saveNew(record: NativeDecisionRecord): Promise<void> {
    await deps.store.append(record)
    byDecision.set(record.decisionId, record)
  }

  async function setRecord(record: NativeDecisionRecord): Promise<void> {
    await deps.store.append(record)
    byDecision.set(record.decisionId, record)
  }

  function sameBrief(left: NativeRouteInput, right: NativeRouteInput): boolean {
    return left.prompt === right.prompt && left.scope === right.scope && left.acceptance === right.acceptance &&
      left.parentRole === right.parentRole && left.rootSessionID === right.rootSessionID &&
      left.parentSessionID === right.parentSessionID && left.kind === right.kind &&
      left.requiredRole === right.requiredRole &&
      left.requiredContextLength === right.requiredContextLength &&
      JSON.stringify(left.requiredCapabilities ?? []) === JSON.stringify(right.requiredCapabilities ?? [])
  }

  function routeResult(record: NativeDecisionRecord): NativeRouteResult {
    if (record.status === "unavailable") return {
      kind: "unavailable", decisionId: record.decisionId, reason: record.reason ?? "no eligible available models",
    }
    if (record.selected && record.status !== "awaiting_selection") return {
      kind: "selected", decisionId: record.decisionId, role: record.selected.role, model: record.selected.model,
    }
    return {
      kind: "awaiting_selection",
      decisionId: record.decisionId,
      reason: record.reason ?? "routing decision is awaiting caller selection",
      candidates: record.choiceCandidates ?? record.request.candidates,
    }
  }

  async function route(input: NativeRouteInput): Promise<NativeRouteResult> {
    await ensureLoaded()
    const invalid = validateInput(input)
    if (invalid) return { kind: "unavailable", reason: invalid }
    const decisionId = input.decisionId ?? createId()
    const inflight = inflightRoutes.get(decisionId)
    if (inflight) {
      if (!sameBrief(input, inflight.input)) throw new Error("routing decision id is already in use by a different task brief or owner")
      return inflight.promise
    }
    const promise = routeOnce({ ...input, decisionId }, decisionId)
    inflightRoutes.set(decisionId, { input, promise })
    try {
      return await promise
    } finally {
      inflightRoutes.delete(decisionId)
    }
  }

  async function routeOnce(input: NativeRouteInput, decisionId: string): Promise<NativeRouteResult> {
    const existing = byDecision.get(decisionId)
    if (existing) {
      if (!sameBrief(input, existing.request.input)) throw new Error("routing decision id is already in use by a different task brief or owner")
      return routeResult(existing)
    }
    const candidates = await snapshot(input)
    if (candidates.length === 0) {
      const reason = input.kind === "consultation" ? "consultation pool has no eligible available models" : "no eligible available models"
      const request = requestFor(input, decisionId, candidates, await deps.outcomes.list())
      await saveNew(makeRecord(request, "unavailable", reason))
      return { kind: "unavailable", decisionId, reason }
    }
    const request = requestFor(input, decisionId, candidates, await deps.outcomes.list())
    const pending = { ...makeRecord(request, "awaiting_selection", "Jev decision is pending or was interrupted"), choiceCandidates: candidates }
    await saveNew(pending)
    const jevResult = await serialJev(async (): Promise<{ answer?: NativeJevAnswer; rawResponse?: unknown; failure?: unknown }> => {
      if (config.monthlyBudgetUsd !== undefined && jevSpendUnknown) return { failure: new Error("jev monthly spend is unknown; Jev paused for budget safety") }
      if (config.monthlyBudgetUsd !== undefined && jevReservedSpend >= config.monthlyBudgetUsd) return { failure: new Error("jev monthly budget cap reached") }
      if (now() < openUntil) return { failure: new Error("jev circuit breaker is open") }
      let rawResponse: unknown
      let billing: NativeJevAnswer["usage"]
      let billed = false
      const account = (usage: NativeJevAnswer["usage"]) => {
        billing = usage
        if (usage?.costUsd === undefined) jevSpendUnknown = true
        else jevReservedSpend += usage.costUsd
        billed = true
      }
      await setRecord({ ...pending, jevAttempted: true, reason: "Jev request is pending; billing awaits the provider receipt" })
      try {
        rawResponse = await deps.jev.choose(request)
        account(jevUsage(rawResponse))
        if (!isJevAnswer(rawResponse, candidates)) throw new Error("malformed Jev response")
        consecutiveFailures = 0
        openUntil = 0
        await persistBreaker()
        await setRecord({ ...pending, jevAttempted: true, jevUsage: billing, jevAnswer: rawResponse, reason: "Jev response captured; validating current availability" })
        return { answer: rawResponse }
      } catch (failure) {
        const notSent = nativeJevFailureNotSent(failure)
        if (!billed && !notSent) account(jevUsage(failure))
        if (!notSent && !nativeJevFailureAdmission(failure)) {
          consecutiveFailures += 1
          if (consecutiveFailures >= breakerLimit) openUntil = now() + breakerCooldownMs
          await persistBreaker()
        }
        const message = failure instanceof Error ? failure.message : String(failure)
        const reason = message === "jev monthly budget cap reached" || message === "jev circuit breaker is open" || message.startsWith("jev monthly spend is unknown") ? message : `jev unavailable: ${message}`
        rawResponse = nativeJevFailureEvidence(failure) ?? rawResponse
        await setRecord({ ...pending, jevAttempted: !notSent, jevUsage: billing, reason, choiceCandidates: candidates, jevFailure: { message: reason, rawResponse } })
        return { failure, rawResponse }
      }
    })
    if (!jevResult.answer) {
      const message = jevResult.failure instanceof Error ? jevResult.failure.message : String(jevResult.failure)
      const reason = message === "jev monthly budget cap reached" || message === "jev circuit breaker is open" ? message : `jev unavailable: ${message}`
      const record = byDecision.get(decisionId) ?? pending
      if (record.reason !== reason) await setRecord({ ...record, reason, choiceCandidates: candidates, jevFailure: { message: reason, rawResponse: jevResult.rawResponse } })
      return { kind: "awaiting_selection", decisionId, reason, candidates }
    }
    const answer = jevResult.answer
    const refreshedCandidates = await snapshot(input)
    const refreshedRecordCandidates = refreshedCandidates
    const candidate = refreshedCandidates.find((item) => item.role === answer.role && sameModel(item.model, answer.model))

    const probabilities = answer.probabilities ?? {}
    const validConfidence = Number.isFinite(answer.confidence) && answer.confidence >= 0 && answer.confidence <= 1
    const confidence = Math.min(answer.confidence, answer.laneConfidence ?? answer.confidence)
    const departmentRoles = new Set<NativeRole>(["planner", "executor", "reviewer"])
    const expectedLane = candidate && departmentRoles.has(candidate.role) ? "department" : "direct"
    const decisionValid = candidate && validConfidence && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 && allowedRoles(input).includes(candidate.role) &&
      (input.requiredRole !== undefined ? answer.role === input.requiredRole : input.kind !== "consultation" ? answer.role !== "advisor" : answer.role === "advisor") &&
      answer.lane === expectedLane
    if (!decisionValid || confidence < threshold) {
      const uncertain = rankUncertainCandidates(refreshedCandidates, probabilities)
      const reason = !decisionValid ? "jev returned an ineligible candidate" : `jev confidence ${confidence.toFixed(3)} is below ${threshold}`
      const choices = uncertain.length ? uncertain : refreshedCandidates.slice(0, 3)
      const record = { ...makeRecord(request, "awaiting_selection", reason, answer, probabilities), candidateSnapshots: [...pending.candidateSnapshots, { capturedAt: new Date(now()).toISOString(), source: "post-jev-revalidation" as const, candidates: refreshedCandidates }], choiceCandidates: choices }
      await setRecord(record)
      return { kind: "awaiting_selection", decisionId, reason, candidates: choices }
    }

    if (!candidate) {
      if (refreshedCandidates.length === 0) {
        const reason = "no eligible available models after Jev routing"
        const record = { ...makeRecord(request, "unavailable", reason, answer, probabilities), candidateSnapshots: [...pending.candidateSnapshots, { capturedAt: new Date(now()).toISOString(), source: "post-jev-revalidation" as const, candidates: refreshedCandidates }] }
        await setRecord(record)
        return { kind: "unavailable", decisionId, reason }
      }
      const record = { ...makeRecord(request, "awaiting_selection", "selected model became unavailable during Jev routing", answer, probabilities), candidateSnapshots: [...pending.candidateSnapshots, { capturedAt: new Date(now()).toISOString(), source: "post-jev-revalidation" as const, candidates: refreshedCandidates }], choiceCandidates: refreshedCandidates }
      await setRecord(record)
      return { kind: "awaiting_selection", decisionId, reason: record.reason ?? "candidate unavailable", candidates: refreshedCandidates }
    }
    const record = { ...makeRecord(request, "selected", undefined, answer, probabilities), candidateSnapshots: [...pending.candidateSnapshots, { capturedAt: new Date(now()).toISOString(), source: "post-jev-revalidation" as const, candidates: refreshedCandidates }], selected: { role: candidate.role, model: candidate.model, by: "jev" as const } }
    await setRecord(record)
    return { kind: "selected", decisionId, role: candidate.role, model: candidate.model }
  }

  async function select(decisionId: string, modelRef: NativeModelRef, role: NativeRole, callerSessionID: string): Promise<NativeRouteResult> {
    return exclusive(async () => {
      await ensureLoaded()
      const record = byDecision.get(decisionId)
      if (!record) return { kind: "unavailable", reason: "routing decision does not exist" }
      if (record.request.input.parentSessionID !== callerSessionID) return { kind: "unavailable", reason: "caller does not own this routing decision" }
      if (record.status !== "awaiting_selection") return { kind: "unavailable", reason: "routing decision is no longer awaiting selection" }
      const refreshedCandidates = await snapshot(record.request.input)
      const offered = record.choiceCandidates ?? record.request.candidates
      const presentedCandidates = refreshedCandidates.filter((candidate) => offered.some((option) =>
        option.role === candidate.role && sameModel(option.model, candidate.model)))
      const choices = presentedCandidates.length > 0 ? presentedCandidates : refreshedCandidates
      const snapshots = [...record.candidateSnapshots, { capturedAt: new Date(now()).toISOString(), source: "selection-revalidation" as const, candidates: choices }]
      const candidate = offered.some((option) => option.role === role && sameModel(option.model, modelRef))
        ? choices.find((item) => item.role === role && sameModel(item.model, modelRef))
        : undefined
      if (!candidate) {
        if (choices.length === 0) return { kind: "unavailable", reason: "no eligible available models" }
        const refreshed = { ...record, candidateSnapshots: snapshots, choiceCandidates: choices, status: "awaiting_selection" as const, reason: "selection is not among the current offered candidates; choose from refreshed candidates" }
        await setRecord(refreshed)
        return { kind: "awaiting_selection", decisionId, reason: refreshed.reason ?? "selection unavailable", candidates: choices }
      }
      const selected = { ...record, candidateSnapshots: snapshots, status: "selected" as const, selected: { role, model: candidate.model, by: "caller" as const }, reason: undefined }
      await setRecord(selected)
      return { kind: "selected", decisionId, role, model: candidate.model }
    })
  }

  async function revalidateSelected(decisionId: string, callerSessionID: string): Promise<NativeRouteResult> {
    return exclusive(async () => {
      await ensureLoaded()
      const record = byDecision.get(decisionId)
      if (!record || record.request.input.parentSessionID !== callerSessionID) return { kind: "unavailable", reason: "caller does not own this routing decision" }
      if (record.status !== "selected" || !record.selected) return { kind: "unavailable", reason: "routing decision is not selected" }
      const choices = await snapshot(record.request.input)
      const snapshots = [...record.candidateSnapshots, { capturedAt: new Date(now()).toISOString(), source: "selection-revalidation" as const, candidates: choices }]
      const candidate = choices.find((item) => item.role === record.selected?.role && sameModel(item.model, record.selected.model))
      if (candidate) {
        await setRecord({ ...record, candidateSnapshots: snapshots })
        return { kind: "selected", decisionId, role: candidate.role, model: candidate.model }
      }
      if (choices.length === 0) {
        await setRecord({ ...record, status: "awaiting_selection", candidateSnapshots: snapshots, reason: "selected model is unavailable and no eligible models remain" })
        return { kind: "unavailable", reason: "no eligible available models" }
      }
      const refreshed = { ...record, status: "awaiting_selection" as const, candidateSnapshots: snapshots, reason: "selected model is no longer available; choose from refreshed candidates" }
      await setRecord(refreshed)
      return { kind: "awaiting_selection", decisionId, reason: refreshed.reason, candidates: choices }
    })
  }

  async function bindResearch(input: NativeRouteInput, model: NativeModelRef): Promise<NativeRouteResult> {
    return exclusive(async () => {
      await ensureLoaded()
      if (input.requiredRole !== "catalog-researcher" || input.parentRole !== "orchestrator" || input.rootSessionID !== input.parentSessionID || input.kind !== "task") return { kind: "unavailable", reason: "explicit maintenance binding requires root catalog research" }
      const origin = input.sourceDecisionID ? byDecision.get(input.sourceDecisionID) : undefined
      if (!origin?.selected?.taskId || origin.request.input.rootSessionID !== input.rootSessionID || origin.selected.role === "catalog-researcher") return { kind: "unavailable", reason: "maintenance requires a dispatched source decision in the same root" }
      const decisionId = input.decisionId ?? createId()
      const existing = byDecision.get(decisionId)
      if (existing) {
        if (!sameBrief(input, existing.request.input) || !existing.selected || !sameModel(existing.selected.model, model)) throw new Error("maintenance decision already belongs to another binding")
        return routeResult(existing)
      }
      const candidates = await snapshot(input)
      const candidate = candidates.find((item) => item.role === "catalog-researcher" && sameModel(item.model, model))
      const request = { ...requestFor(input, decisionId, candidates, await deps.outcomes.list()), instructions: "Explicit caller configuration binds the maintenance executor; no Jev model selection was requested." }
      if (!candidate) { await saveNew(makeRecord(request, "unavailable", "configured maintenance executor is ineligible")); return { kind: "unavailable", decisionId, reason: "configured maintenance executor is ineligible" } }
      await saveNew({ ...makeRecord(request, "selected", "explicit catalog.research_executor binding"), selected: { role: "catalog-researcher", model: candidate.model, by: "caller" } })
      return { kind: "selected", decisionId, role: "catalog-researcher", model: candidate.model }
    })
  }

  async function recordDispatch(decisionId: string, dispatch: NativeDispatchFact, callerSessionID: string): Promise<void> {
    await exclusive(async () => {
      await ensureLoaded()
      const record = byDecision.get(decisionId)
      if (!record || record.request.input.parentSessionID !== callerSessionID) throw new Error("caller does not own this routing decision")
      if (record.status !== "selected") throw new Error("routing decision has no selected dispatch")
      if (!record.selected || record.selected.role !== dispatch.role || !sameModel(record.selected.model, dispatch.model)) throw new Error("actual dispatch does not match the selected role and model")
      if (record.selected.taskId || record.selected.sessionId) {
        if (record.selected.taskId === dispatch.taskId && record.selected.sessionId === dispatch.sessionId) return
        throw new Error("routing decision is already assigned to another task or session")
      }
      const fresh = await snapshot(record.request.input)
      if (!fresh.some((candidate) => candidate.role === dispatch.role && sameModel(candidate.model, dispatch.model))) throw new Error("selected candidate is no longer available")
      await setRecord({ ...record, selected: { ...record.selected, taskId: dispatch.taskId, sessionId: dispatch.sessionId } })
      if (dispatch.role !== "catalog-researcher" && !(await deps.knowledge.get(dispatch.model))?.known) void queueResearch(dispatch.model, { decisionId, rootSessionID: record.request.input.rootSessionID, parentSessionID: record.request.input.parentSessionID, parentRole: record.request.input.parentRole })
    })
  }

  async function recordOutcome(decisionId: string, outcome: NativeOutcomeFact, callerSessionID: string): Promise<void> {
    await exclusive(async () => {
      await ensureLoaded()
      const record = byDecision.get(decisionId)
      if (!record || record.request.input.parentSessionID !== callerSessionID) throw new Error("caller does not own this routing decision")
      if (outcome.provenance !== "runtime") throw new Error("outcomes must come from runtime task state")
      if (!record.selected || !sameModel(record.selected.model, outcome.model) || record.selected.role !== outcome.role ||
        outcome.taskKind !== record.request.input.kind ||
        outcome.taskId === undefined || outcome.sessionId === undefined ||
        record.selected.taskId !== outcome.taskId || record.selected.sessionId !== outcome.sessionId) {
        throw new Error("outcome must match the recorded actual dispatch")
      }
      await setRecord({ ...record, outcome: { ...outcome, verification: outcome.verification ?? "unknown" }, status: "completed" })
    })
  }

  async function exportLedger(): Promise<readonly string[]> {
    await ensureLoaded()
    return deps.store.exportLines()
  }

  return { route, bindResearch, recoverResearch, select, revalidateSelected, recordDispatch, recordOutcome, exportLedger }
}

export type NativeRouter = ReturnType<typeof createNativeRouter>
