import { hasValidProbabilityMass } from "./probability-mass"
import { candidateKey } from "./candidate-ranking"
import type { NativeCandidate, NativeJevAnswer } from "./types"

export function isJevAnswer(value: unknown, candidates: readonly NativeCandidate[]): value is NativeJevAnswer {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const answer = value as Record<string, unknown>
  if (typeof answer.role !== "string" || !answer.model || typeof answer.model !== "object" || Array.isArray(answer.model)) return false
  const model = answer.model as Record<string, unknown>
  if (typeof model.providerID !== "string" || typeof model.id !== "string" ||
    typeof answer.confidence !== "number" || !Number.isFinite(answer.confidence) || answer.confidence < 0 || answer.confidence > 1 ||
    !answer.probabilities || typeof answer.probabilities !== "object" || Array.isArray(answer.probabilities)) return false
  const probabilities = answer.probabilities as Record<string, unknown>
  if (!Object.values(probabilities).every((probability) => typeof probability === "number" && Number.isFinite(probability) && probability >= 0 && probability <= 1)) return false
  const allowedKeys = new Set(candidates.map((candidate) => candidateKey(candidate.role, candidate.model)))
  if (!hasValidProbabilityMass(Object.values(probabilities)) || Object.keys(probabilities).some((key) => !allowedKeys.has(key))) return false
  const selectedKey = `${answer.role}|${model.providerID}/${model.id}`
  if (!allowedKeys.has(selectedKey) || typeof probabilities[selectedKey] !== "number") return false
  if (answer.lane !== undefined && answer.lane !== "direct" && answer.lane !== "department") return false
  if (answer.laneConfidence !== undefined && (typeof answer.laneConfidence !== "number" || !Number.isFinite(answer.laneConfidence) || answer.laneConfidence < 0 || answer.laneConfidence > 1)) return false
  if (answer.usage !== undefined) {
    if (!answer.usage || typeof answer.usage !== "object" || Array.isArray(answer.usage)) return false
    const usage = answer.usage as Record<string, unknown>
    if ([usage.inputTokens, usage.outputTokens, usage.costUsd].some((amount) => amount !== undefined && (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0))) return false
  }
  return true
}
