import type {
  NativeCandidate,
  NativeDecisionRecord,
  NativeLedgerRecord,
  NativeModelFacts,
  NativeModelRef,
} from "./types"

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

function isModelRef(value: unknown): value is NativeModelRef {
  return isObject(value) && typeof value.providerID === "string" && typeof value.id === "string"
}

function isModelFacts(value: unknown): value is NativeModelFacts {
  return isObject(value) && typeof value.providerID === "string" && typeof value.id === "string" &&
    typeof value.available === "boolean" &&
    (value.inputPricePerMillion === undefined || (typeof value.inputPricePerMillion === "number" && Number.isFinite(value.inputPricePerMillion) && value.inputPricePerMillion >= 0)) &&
    (value.outputPricePerMillion === undefined || (typeof value.outputPricePerMillion === "number" && Number.isFinite(value.outputPricePerMillion) && value.outputPricePerMillion >= 0)) &&
    (value.contextLength === undefined || (Number.isInteger(value.contextLength) && Number(value.contextLength) >= 0)) &&
    (value.toolCall === undefined || typeof value.toolCall === "boolean") &&
    (value.capabilities === undefined || (Array.isArray(value.capabilities) && value.capabilities.every((item) => typeof item === "string")) )
}

function isCandidate(value: unknown): value is NativeCandidate {
  return isObject(value) && typeof value.role === "string" && isModelRef(value.model) &&
    isModelFacts(value.facts) && isObject(value.knowledge) && typeof value.knowledge.known === "boolean" &&
    isModelRef(value.knowledge.model)
}

function isDecisionRecord(value: Record<string, unknown>): value is Record<string, unknown> & NativeDecisionRecord {
  if (value.version !== 1 || value.type !== "decision" || typeof value.decisionId !== "string" ||
    typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt)) ||
    !["awaiting_selection", "selected", "completed", "unavailable"].includes(String(value.status))) return false
  const request = value.request
  if (!isObject(request) || typeof request.decisionId !== "string" || request.decisionId !== value.decisionId ||
    !isObject(request.input) || typeof request.input.prompt !== "string" ||
    typeof request.input.parentRole !== "string" || typeof request.input.rootSessionID !== "string" ||
    typeof request.input.parentSessionID !== "string" ||
    (request.input.kind !== "task" && request.input.kind !== "consultation") ||
    !Array.isArray(request.allowedRoles) || !request.allowedRoles.every((role) => typeof role === "string") ||
    !Array.isArray(request.candidates) || !request.candidates.every(isCandidate) ||
    !Array.isArray(request.knowledge) || !Array.isArray(request.outcomes) || typeof request.instructions !== "string") return false
  if (value.jevCallId !== undefined && (typeof value.jevCallId !== "string" || !value.jevCallId.length)) return false
  if (value.jevAttempted !== undefined && typeof value.jevAttempted !== "boolean") return false
  if (value.jevUsage !== undefined && (!isObject(value.jevUsage) || [value.jevUsage.inputTokens, value.jevUsage.outputTokens, value.jevUsage.costUsd].some((amount) => amount !== undefined && (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0)))) return false
  if (value.selected !== undefined) {
    const selected = value.selected
    if (!isObject(selected) || typeof selected.role !== "string" || !isModelRef(selected.model) ||
      !["jev", "caller", "runtime"].includes(String(selected.by)) ||
      (selected.taskId !== undefined && typeof selected.taskId !== "string") ||
      (selected.sessionId !== undefined && typeof selected.sessionId !== "string")) return false
  }
  if (!Array.isArray(value.candidateSnapshots) || !value.candidateSnapshots.every((snapshot) => isObject(snapshot) &&
    typeof snapshot.capturedAt === "string" && Number.isFinite(Date.parse(snapshot.capturedAt)) &&
    ["initial", "post-jev-revalidation", "selection-revalidation"].includes(String(snapshot.source)) &&
    Array.isArray(snapshot.candidates) && snapshot.candidates.every(isCandidate))) return false
  if (value.choiceCandidates !== undefined && (!Array.isArray(value.choiceCandidates) || !value.choiceCandidates.every(isCandidate))) return false
  if (value.jevFailure !== undefined && (!isObject(value.jevFailure) || typeof value.jevFailure.message !== "string")) return false
  if (value.jevAnswer !== undefined) {
    const answer = value.jevAnswer
    if (!isObject(answer) || typeof answer.role !== "string" || !isModelRef(answer.model) ||
      typeof answer.confidence !== "number" || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1 ||
      !isObject(answer.probabilities) || !Object.values(answer.probabilities).every((probability) => typeof probability === "number" && Number.isFinite(probability) && probability >= 0 && probability <= 1)) return false
    const knownKeys = new Set(request.candidates.map((candidate) => `${candidate.role}|${candidate.model.providerID}/${candidate.model.id}`))
    if (Object.keys(answer.probabilities).some((key) => !knownKeys.has(key)) ||
      (answer.laneConfidence !== undefined && (typeof answer.laneConfidence !== "number" || !Number.isFinite(answer.laneConfidence) || answer.laneConfidence < 0 || answer.laneConfidence > 1))) return false
    if (answer.usage !== undefined) {
      if (!isObject(answer.usage) || [answer.usage.inputTokens, answer.usage.outputTokens, answer.usage.costUsd].some((amount) => amount !== undefined && (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0))) return false
    }
  }
  return true
}

export function parseNativeLedgerRecord(value: unknown): NativeLedgerRecord | undefined {
  if (!isObject(value) || value.version !== 1) return undefined
  if (value.type === "jev_call") {
    const usage = value.usage
    return typeof value.callId === "string" && value.callId.length > 0 &&
      (value.purpose === "routing" || value.purpose === "classification") && typeof value.inputDigest === "string" && /^[a-f0-9]{64}$/.test(value.inputDigest) &&
      typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)) && ["pending", "complete", "not_sent"].includes(String(value.status)) &&
      (usage === undefined || isObject(usage) && [usage.inputTokens, usage.outputTokens, usage.costUsd].every(amount => amount === undefined || typeof amount === "number" && Number.isFinite(amount) && amount >= 0)) &&
      (value.status !== "not_sent" || usage === undefined) ? value as unknown as NativeLedgerRecord : undefined
  }
  if (value.type === "decision") return isDecisionRecord(value) ? value : undefined
  if (value.type === "breaker" && Number.isInteger(value.consecutiveFailures) &&
    Number(value.consecutiveFailures) >= 0 && Number.isFinite(value.openUntil) && Number(value.openUntil) >= 0) {
    return value as unknown as NativeLedgerRecord
  }
  return undefined
}

export function isVersionedNativeLedgerValue(value: unknown): boolean {
  return isObject(value) && value.version === 1
}
