// MODIFIED: classification receives current source facts, never routing outcomes or cached recommendations.
import type { NativeKnowledgeFact } from "../native-routing/types"
import type { NativeCatalogModelFacts } from "./types"
import type { JobClassificationInput } from "./job-classification-types"

export function jobClassificationInput(model: NativeCatalogModelFacts, knowledge?: NativeKnowledgeFact): JobClassificationInput {
  const facts: Record<string, unknown> = {}
  if (model.contextLength !== undefined) facts.contextLength = model.contextLength
  if (model.toolCall !== undefined) facts.toolCall = model.toolCall
  if (model.capabilities !== undefined) facts.capabilities = [...new Set(model.capabilities)].sort()
  const evidence: JobClassificationInput["evidence"][number][] = []
  if (Object.keys(facts).length) evidence.push({ source: "opencode.model.list", facts })
  // Price and transient availability are excluded: neither changes job suitability.
  if (knowledge?.known && knowledge.model.providerID === model.providerID && knowledge.model.id === model.id && knowledge.source?.trim()) {
    const researched: Record<string, unknown> = {}
    if (knowledge.summary?.trim()) researched.summary = knowledge.summary
    if (knowledge.strengths?.length) researched.strengths = [...new Set(knowledge.strengths)].sort()
    if (knowledge.limitations?.length) researched.limitations = [...new Set(knowledge.limitations)].sort()
    if (Object.keys(researched).length) evidence.push({ source: knowledge.source.trim(), facts: researched })
  }
  return { model: { providerID: model.providerID, id: model.id }, evidence }
}
