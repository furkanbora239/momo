import type { NativeOutcomeFact, NativeOutcomeStore, NativeRouterStore } from "./types"

export function createNativeLedgerOutcomeReader(store: Pick<NativeRouterStore, "load">): NativeOutcomeStore {
  return {
    async list(): Promise<readonly NativeOutcomeFact[]> {
      const records = await store.load()
      return records.flatMap((record) => {
        if (record.type !== "decision" || !record.outcome || record.outcome.provenance !== "runtime") return []
        return [record.outcome]
      })
    },
  }
}
