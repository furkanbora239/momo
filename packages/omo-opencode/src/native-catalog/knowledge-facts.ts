import type { NativeKnowledgeFact } from "../native-routing/types"

export function hasVerifiedKnowledgeSource(fact: NativeKnowledgeFact): boolean {
  return fact.known && typeof fact.source === "string" && fact.source.trim().length > 0
}

export function hasUsableModelKnowledge(fact: NativeKnowledgeFact | undefined): boolean {
  return fact !== undefined && hasVerifiedKnowledgeSource(fact) &&
    [fact.summary, ...(fact.strengths ?? []), ...(fact.limitations ?? [])].some((value) => Boolean(value?.trim()))
}
