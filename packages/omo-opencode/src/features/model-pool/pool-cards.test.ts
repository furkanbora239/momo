import { describe, expect, it } from "bun:test"

import type { ModelPool } from "../../shared/model-pool"
import type { ProviderHealthSnapshot } from "../../shared/provider-health"
import type { PoolCatalogRow } from "./pool-catalog-rows"
import {
  buildPoolCards,
  formatPoolPrice,
  groupPoolCards,
  poolBadge,
  poolProviderHealthNote,
} from "./pool-cards"

function row(input: Partial<PoolCatalogRow> & { providerID: string; modelID: string }): PoolCatalogRow {
  return {
    inputPerM: 1,
    outputPerM: 2,
    costTier: "budget",
    ...input,
  }
}

function pool(allowed: ModelPool["allowed"]): ModelPool {
  return { version: 1, allowed, updatedAt: "2026-01-01T00:00:00.000Z" }
}

const noHealth = (): string | undefined => undefined

describe("formatPoolPrice", () => {  it("#given known prices #when formatting #then it renders per-million pricing", () => {
    expect(formatPoolPrice(1.5, 4.25)).toBe("in $1.50 / out $4.25 per M")
  })

  it("#given a missing price #when formatting #then it reports the price unknown", () => {
    expect(formatPoolPrice(undefined, 2)).toBe("price unknown")
    expect(formatPoolPrice(1, undefined)).toBe("price unknown")
  })
})

describe("poolProviderHealthNote", () => {
  const now = 1_000

  it("#given a healthy provider #when reading the note #then it is undefined", () => {
    expect(poolProviderHealthNote({}, "openai", now)).toBeUndefined()
  })

  it("#given an expired cooldown #when reading the note #then it is undefined", () => {
    const snapshot: ProviderHealthSnapshot = {
      openai: { reason: "quota_exceeded", unavailableUntil: now - 1 },
    }
    expect(poolProviderHealthNote(snapshot, "openai", now)).toBeUndefined()
  })

  it("#given an active cooldown #when reading the note #then it reports the reason", () => {
    const snapshot: ProviderHealthSnapshot = {
      openai: { reason: "quota_exceeded", unavailableUntil: now + 1 },
    }
    expect(poolProviderHealthNote(snapshot, "openai", now)).toBe("unhealthy (quota_exceeded)")
  })

  it("#given mixed-case provider ids #when reading the note #then the lookup normalizes", () => {
    const snapshot: ProviderHealthSnapshot = {
      openai: { reason: "missing_api_key", unavailableUntil: now + 1 },
    }
    expect(poolProviderHealthNote(snapshot, "  OpenAI ", now)).toBe("unhealthy (missing_api_key)")
  })
})

describe("poolBadge", () => {
  it("#given an allowed model #when building the badge #then it is positive", () => {
    expect(poolBadge(true, false)).toEqual({ text: "ALLOWED", tone: "positive" })
  })

  it("#given an excluded model #when building the badge #then it is negative", () => {
    expect(poolBadge(false, false)).toEqual({ text: "EXCLUDED", tone: "negative" })
  })

  it("#given a preferred model #when building the badge #then it carries the preferred marker", () => {
    expect(poolBadge(true, true).text).toBe("ALLOWED · PREFERRED")
  })
})

describe("buildPoolCards", () => {
  it("#given priced rows #when building cards #then the body carries price and tier", () => {
    const cards = buildPoolCards({
      pool: pool([]),
      rows: [row({ providerID: "openai", modelID: "gpt-5", inputPerM: 2, outputPerM: 8, costTier: "premium" })],
      healthNote: noHealth,
    })
    expect(cards).toHaveLength(1)
    expect(cards[0].bodyLines).toContain("in $2.00 / out $8.00 per M")
    expect(cards[0].bodyLines).toContain("premium")
  })

  it("#given a row without prices #when building cards #then the body reports the price unknown", () => {
    const cards = buildPoolCards({
      pool: pool([]),
      rows: [row({ providerID: "openai", modelID: "gpt-5", inputPerM: undefined, outputPerM: undefined, costTier: undefined })],
      healthNote: noHealth,
    })
    expect(cards[0].bodyLines).toContain("price unknown")
    expect(cards[0].bodyLines).not.toContain("budget")
  })

  it("#given an unhealthy provider #when building cards #then the body carries the health note", () => {
    const cards = buildPoolCards({
      pool: pool([]),
      rows: [row({ providerID: "openai", modelID: "gpt-5" })],
      healthNote: () => "unhealthy (quota_exceeded)",
    })
    expect(cards[0].bodyLines).toContain("unhealthy (quota_exceeded)")
  })

  it("#given a healthy provider #when building cards #then no health note is present", () => {
    const cards = buildPoolCards({
      pool: pool([]),
      rows: [row({ providerID: "openai", modelID: "gpt-5" })],
      healthNote: noHealth,
    })
    expect(cards[0].bodyLines.some((line) => line.startsWith("unhealthy"))).toBe(false)
  })

  it("#given an empty pool #when building cards #then every model is allowed", () => {
    const cards = buildPoolCards({
      pool: pool([]),
      rows: [row({ providerID: "openai", modelID: "gpt-5" })],
      healthNote: noHealth,
    })
    expect(cards[0].badge?.text).toBe("ALLOWED")
  })

  it("#given a restricted pool #when building cards #then excluded models get the excluded badge", () => {
    const cards = buildPoolCards({
      pool: pool([{ providerID: "openai", modelID: "gpt-5" }]),
      rows: [
        row({ providerID: "openai", modelID: "gpt-5" }),
        row({ providerID: "openai", modelID: "gpt-5-mini" }),
      ],
      healthNote: noHealth,
    })
    expect(cards[0].badge?.text).toBe("ALLOWED")
    expect(cards[1].badge?.text).toBe("EXCLUDED")
  })

  it("#given a preferred entry #when building cards #then the badge carries the marker", () => {
    const cards = buildPoolCards({
      pool: pool([{ providerID: "openai", modelID: "gpt-5", preferred: true }]),
      rows: [row({ providerID: "openai", modelID: "gpt-5" })],
      healthNote: noHealth,
    })
    expect(cards[0].badge?.text).toBe("ALLOWED · PREFERRED")
  })
})

describe("groupPoolCards", () => {
  it("#given rows from several providers #when grouping #then each provider becomes one ordered group", () => {
    const cards = buildPoolCards({
      pool: pool([]),
      rows: [
        row({ providerID: "openai", modelID: "gpt-5" }),
        row({ providerID: "google", modelID: "gemini-3" }),
        row({ providerID: "openai", modelID: "gpt-5-mini" }),
      ],
      healthNote: noHealth,
    })
    const groups = groupPoolCards(cards)
    expect(groups.map((group) => group.header)).toEqual(["openai", "google"])
    expect(groups[0].cards.map((card) => card.modelID)).toEqual(["gpt-5", "gpt-5-mini"])
    expect(groups[1].cards.map((card) => card.modelID)).toEqual(["gemini-3"])
  })
})
