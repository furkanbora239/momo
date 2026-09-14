import { readRuntimeModelCost } from "@oh-my-opencode/model-core"

import { readProviderModelsCache } from "../../shared/connected-providers-cache"

export type PoolCostTier = "budget" | "balanced" | "premium"

export type PoolCatalogRow = {
  providerID: string
  modelID: string
  inputPerM: number | undefined
  outputPerM: number | undefined
  costTier: PoolCostTier | undefined
}

// Mirrors the thresholds used by the catalog MCP so the panel and the
// orchestrator agree on what "budget" means.
const BUDGET_BLENDED_PER_M = 1.5
const PREMIUM_BLENDED_PER_M = 8

function isPoolCostTier(value: unknown): value is PoolCostTier {
  return value === "budget" || value === "balanced" || value === "premium"
}

export function deriveCostTier(
  inputPerM: number | undefined,
  outputPerM: number | undefined,
): PoolCostTier | undefined {
  if (inputPerM === undefined || outputPerM === undefined) return undefined
  const blended = (inputPerM + outputPerM) / 2
  if (blended < BUDGET_BLENDED_PER_M) return "budget"
  if (blended < PREMIUM_BLENDED_PER_M) return "balanced"
  return "premium"
}

/**
 * Reads the on-disk provider models cache (never the network) and flattens
 * it into renderable rows. Returns null when no catalog is available yet.
 */
export function collectPoolCatalogRows(): PoolCatalogRow[] | null {
  const cache = readProviderModelsCache()
  if (cache === null) return null

  const rows: PoolCatalogRow[] = []
  for (const [providerID, entries] of Object.entries(cache.models)) {
    for (const entry of entries) {
      if (typeof entry === "string") {
        rows.push({
          providerID,
          modelID: entry,
          inputPerM: undefined,
          outputPerM: undefined,
          costTier: undefined,
        })
        continue
      }
      const cost = readRuntimeModelCost(entry)
      const costTier = isPoolCostTier(entry.cost_tier)
        ? entry.cost_tier
        : deriveCostTier(cost?.input, cost?.output)
      rows.push({
        providerID,
        modelID: entry.id,
        inputPerM: cost?.input,
        outputPerM: cost?.output,
        costTier,
      })
    }
  }
  return rows.length > 0 ? rows : null
}
