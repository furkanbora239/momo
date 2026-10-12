import type { NativeCandidate, NativeModelFacts, NativeModelRef, NativeRole } from "./types"

export const refKey = (model: NativeModelRef): string => `${model.providerID}/${model.id}`
export const candidateKey = (role: NativeRole, model: NativeModelRef): string => `${role}|${refKey(model)}`
export const sameModel = (left: NativeModelRef, right: NativeModelRef): boolean =>
  left.providerID === right.providerID && left.id === right.id

export function candidateFrom(facts: NativeModelFacts, role: NativeRole, knowledge: NativeCandidate["knowledge"]): NativeCandidate {
  return { role, model: { providerID: facts.providerID, id: facts.id }, facts, knowledge }
}

function probabilityFor(candidate: NativeCandidate, probabilities: Readonly<Record<string, number>>): number {
  const value = probabilities[candidateKey(candidate.role, candidate.model)] ?? probabilities[refKey(candidate.model)]
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0
}

export function rankUncertainCandidates(
  candidates: readonly NativeCandidate[],
  probabilities: Readonly<Record<string, number>>,
): NativeCandidate[] {
  const ranked = candidates.map((candidate) => ({ candidate, probability: probabilityFor(candidate, probabilities) }))
  ranked.sort((a, b) => b.probability - a.probability)
  return ranked.slice(0, 3).map(({ candidate, probability }) => ({ ...candidate, probability }))
}
