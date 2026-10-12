import type { NativeKnowledgeFact } from "../native-routing/types"

export function hasVerifiedKnowledgeSource(fact: NativeKnowledgeFact): boolean {
  return fact.known && typeof fact.source === "string" && fact.source.trim().length > 0
}
