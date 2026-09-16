import type { CardDescriptor, CardGroup, CardTone } from "../tui-card"
import type { ModelPool } from "../../shared/model-pool"
import { isModelAllowed, isModelPreferred } from "../../shared/model-pool"
import type { ProviderHealthSnapshot } from "../../shared/provider-health"
import type { PoolCatalogRow, PoolCostTier } from "./pool-catalog-rows"

export type PoolCard = CardDescriptor & {
  readonly providerID: string
  readonly modelID: string
}

export function formatPoolPrice(
  inputPerM: number | undefined,
  outputPerM: number | undefined,
): string {
  if (inputPerM === undefined || outputPerM === undefined) {
    return "price unknown"
  }
  return `in $${inputPerM.toFixed(2)} / out $${outputPerM.toFixed(2)} per M`
}

/**
 * Mirrors provider-health availability semantics purely: an entry whose
 * cooldown has not expired means the provider is unhealthy.
 */
export function poolProviderHealthNote(
  snapshot: ProviderHealthSnapshot,
  providerID: string,
  now: number,
): string | undefined {
  const entry = snapshot[providerID.trim().toLowerCase()]
  if (!entry) return undefined
  if (now >= entry.unavailableUntil) return undefined
  return `unhealthy (${entry.reason ?? "unknown reason"})`
}

export function poolBadge(allowed: boolean, preferred: boolean): { text: string; tone: CardTone } {
  const state = allowed ? "ALLOWED" : "EXCLUDED"
  const text = preferred ? `${state} · PREFERRED` : state
  return { text, tone: allowed ? "positive" : "negative" }
}

export function buildPoolCards(input: {
  readonly pool: ModelPool
  readonly rows: readonly PoolCatalogRow[]
  readonly healthNote: (providerID: string) => string | undefined
}): PoolCard[] {
  return input.rows.map((row) => {
    const allowed = isModelAllowed(input.pool, row.providerID, row.modelID)
    const preferred = isModelPreferred(input.pool, row.providerID, row.modelID)
    const health = input.healthNote(row.providerID)
    const bodyLines = [
      formatPoolPrice(row.inputPerM, row.outputPerM),
      ...(row.costTier !== undefined ? [row.costTier satisfies PoolCostTier] : []),
      ...(health !== undefined ? [health] : []),
    ]
    return {
      id: `${row.providerID}/${row.modelID}`,
      providerID: row.providerID,
      modelID: row.modelID,
      title: row.modelID,
      badge: poolBadge(allowed, preferred),
      bodyLines,
      indent: 0,
    }
  })
}

export function poolFilterTexts(card: PoolCard): readonly string[] {
  return [`${card.providerID}/${card.modelID}`]
}

export function groupPoolCards(cards: readonly PoolCard[]): CardGroup[] {
  const groups: CardGroup[] = []
  const byProvider = new Map<string, CardDescriptor[]>()
  for (const card of cards) {
    const existing = byProvider.get(card.providerID)
    if (existing === undefined) {
      const list: CardDescriptor[] = [card]
      byProvider.set(card.providerID, list)
      groups.push({ header: card.providerID, cards: list })
      continue
    }
    existing.push(card)
  }
  return groups
}
