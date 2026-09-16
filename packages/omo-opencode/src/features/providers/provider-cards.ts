import type { CardBadge, CardDescriptor, CardGroup } from "../tui-card"
import type { ProviderModelsCache } from "../../shared/connected-providers-cache"
import type { ProviderHealthSnapshot } from "../../shared/provider-health"
import { isProviderDisabled, type ProviderToggles } from "../../shared/provider-toggles"

export type ProviderCard = CardDescriptor & {
  readonly providerID: string
  readonly modelCount: number | undefined
  readonly disabled: boolean
  readonly healthNote: string | undefined
}

export function providerHealthNote(
  snapshot: ProviderHealthSnapshot,
  providerID: string,
  now: number,
): string | undefined {
  const entry = snapshot[providerID.trim().toLowerCase()]
  if (!entry) return undefined
  if (now >= entry.unavailableUntil) return undefined
  return `unhealthy (${entry.reason ?? "unknown reason"})`
}

export function providerBadge(
  disabled: boolean,
  healthNote: string | undefined,
): CardBadge {
  if (disabled) return { text: "DISABLED", tone: "negative" }
  if (healthNote !== undefined) return { text: "UNHEALTHY", tone: "warning" }
  return { text: "HEALTHY", tone: "positive" }
}

export function providerModelCount(
  cache: ProviderModelsCache | null,
  providerID: string,
): number | undefined {
  const entries = cache?.models[providerID]
  return Array.isArray(entries) ? entries.length : undefined
}

export function buildProviderCards(input: {
  readonly toggles: ProviderToggles
  readonly cache: ProviderModelsCache | null
  readonly healthNote: (providerID: string) => string | undefined
}): ProviderCard[] {
  const providerIDs = new Set<string>()
  if (input.cache !== null) {
    for (const providerID of Object.keys(input.cache.models)) {
      providerIDs.add(providerID)
    }
    for (const providerID of input.cache.connected ?? []) {
      providerIDs.add(providerID)
    }
  }
  for (const providerID of input.toggles.disabled) {
    providerIDs.add(providerID)
  }

  const cards: ProviderCard[] = []
  for (const providerID of providerIDs) {
    const disabled = isProviderDisabled(input.toggles, providerID)
    const health = input.healthNote(providerID)
    const modelCount = providerModelCount(input.cache, providerID)
    const bodyLines = [
      modelCount === undefined ? "models unknown" : `${modelCount} models`,
      ...(disabled ? ["excluded from catalog and delegation"] : []),
      ...(health !== undefined ? [health] : []),
    ]
    cards.push({
      id: providerID,
      providerID,
      modelCount,
      disabled,
      healthNote: health,
      title: providerID,
      badge: providerBadge(disabled, health),
      bodyLines,
      indent: 0,
    })
  }
  return cards
}

export function providerFilterTexts(card: ProviderCard): readonly string[] {
  return [card.providerID]
}

export function groupProviderCards(cards: readonly ProviderCard[]): CardGroup[] {
  return [{ header: undefined, cards }]
}
