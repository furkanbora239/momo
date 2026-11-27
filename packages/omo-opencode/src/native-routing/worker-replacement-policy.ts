// MODIFIED: bound automatic replacement by the original assignment's known rates.
import { refKey, sameModel } from "./candidate-ranking"
import type { NativeCandidate, NativeDecisionRecord, NativeModelFacts } from "./types"

export function workerReplacementCandidates(
  origin: NativeDecisionRecord,
  live: readonly NativeCandidate[],
  excludeProvider: boolean,
): NativeCandidate[] {
  if (origin.selected?.role !== "worker") return []
  const originalModel = origin.selected.model
  const ceiling = origin.workerPriceCeilingUsd
  return live.filter(candidate => {
    if (candidate.role !== "worker" || candidate.facts.toolCall !== true || sameModel(candidate.model, originalModel)) return false
    if (excludeProvider && candidate.model.providerID === originalModel.providerID) return false
    const rates = usdRates(candidate.facts)
    if (!rates) return false
    if (rates.input === 0 && rates.output === 0) return true
    return ceiling !== undefined && rates.input <= ceiling.input && rates.output <= ceiling.output
  }).sort((left, right) => {
    const a = usdRates(left.facts)
    const b = usdRates(right.facts)
    return (a?.input ?? 0) - (b?.input ?? 0) || (a?.output ?? 0) - (b?.output ?? 0) || refKey(left.model).localeCompare(refKey(right.model))
  })
}

export function workerPriceCeiling(
  record: NativeDecisionRecord,
  dispatched: NativeCandidate,
): { input: number; output: number } | undefined {
  if (dispatched.role !== "worker") return undefined
  const assigned = [...record.candidateSnapshots].reverse().flatMap(snapshot => snapshot.candidates)
    .find(candidate => candidate.role === "worker" && sameModel(candidate.model, dispatched.model))
  const selected = usdRates(assigned?.facts)
  const current = usdRates(dispatched.facts)
  if (!selected || !current) return undefined
  return { input: Math.min(selected.input, current.input), output: Math.min(selected.output, current.output) }
}

function usdRates(facts?: NativeModelFacts): { input: number; output: number } | undefined {
  const input = facts?.inputPricePerMillion
  const output = facts?.outputPricePerMillion
  if (facts?.priceCurrency !== "USD" || !facts.priceOrigin || !facts.priceSource || facts.priceSource === "unknown") return undefined
  if (input === undefined || output === undefined || !Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) return undefined
  return { input, output }
}
