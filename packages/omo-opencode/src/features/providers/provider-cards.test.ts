import { describe, expect, it } from "bun:test"

import type { ProviderModelsCache } from "../../shared/connected-providers-cache"
import type { ProviderHealthSnapshot } from "../../shared/provider-health"
import type { ProviderToggles } from "../../shared/provider-toggles"
import {
  buildProviderCards,
  providerBadge,
  providerHealthNote,
  providerModelCount,
} from "./provider-cards"

function togglesWith(...disabled: string[]): ProviderToggles {
  return { version: 1, disabled, updatedAt: "2026-01-01T00:00:00.000Z" }
}

function cacheWith(models: Record<string, string[]>, connected: string[] = []): ProviderModelsCache {
  return { models, connected, updatedAt: "2026-01-01T00:00:00.000Z" }
}

describe("provider cards", () => {
  it("#given a cache #when building cards #then lists every provider with its model count", () => {
    // given
    const cache = cacheWith({ openai: ["gpt-5.5", "gpt-5.6"], google: ["gemini-3"] }, ["openai", "google"])

    // when
    const cards = buildProviderCards({ toggles: togglesWith(), cache, healthNote: () => undefined })

    // then
    const byProvider = new Map(cards.map((card) => [card.providerID, card]))
    expect(byProvider.get("openai")?.modelCount).toBe(2)
    expect(byProvider.get("google")?.modelCount).toBe(1)
    expect(byProvider.get("openai")?.disabled).toBe(false)
  })

  it("#given a missing cache #when building cards #then reports models unknown", () => {
    // given
    const cache = null

    // when
    const cards = buildProviderCards({ toggles: togglesWith("openai"), cache, healthNote: () => undefined })

    // then
    const card = cards.find((entry) => entry.providerID === "openai")
    expect(card?.modelCount).toBeUndefined()
    expect(card?.bodyLines).toContain("models unknown")
  })

  it("#given a toggles-only provider #when building cards #then unions it into the list", () => {
    // given
    const cache = cacheWith({ openai: ["gpt-5.5"] }, ["openai"])
    const toggles = togglesWith("anthropic")

    // when
    const cards = buildProviderCards({ toggles, cache, healthNote: () => undefined })

    // then
    const ids = cards.map((card) => card.providerID)
    expect(ids).toContain("openai")
    expect(ids).toContain("anthropic")
  })

  it("#given a disabled provider #when building cards #then shows DISABLED badge and exclusion line", () => {
    // given
    const cache = cacheWith({ openai: ["gpt-5.5"] }, ["openai"])
    const toggles = togglesWith("openai")

    // when
    const cards = buildProviderCards({ toggles, cache, healthNote: () => undefined })

    // then
    const card = cards.find((entry) => entry.providerID === "openai")
    expect(card?.badge).toEqual({ text: "DISABLED", tone: "negative" })
    expect(card?.bodyLines).toContain("excluded from catalog and delegation")
  })

  it("#given a healthy provider #when building cards #then shows HEALTHY badge", () => {
    // given
    const cache = cacheWith({ openai: ["gpt-5.5"] }, ["openai"])

    // when
    const cards = buildProviderCards({ toggles: togglesWith(), cache, healthNote: () => undefined })

    // then
    const card = cards.find((entry) => entry.providerID === "openai")
    expect(card?.badge).toEqual({ text: "HEALTHY", tone: "positive" })
  })

  it("#given an unhealthy provider #when building cards #then shows UNHEALTHY badge with reason", () => {
    // given
    const cache = cacheWith({ openai: ["gpt-5.5"] }, ["openai"])
    const healthNote = (providerID: string) =>
      providerID === "openai" ? "unhealthy (quota_exceeded)" : undefined

    // when
    const cards = buildProviderCards({ toggles: togglesWith(), cache, healthNote })

    // then
    const card = cards.find((entry) => entry.providerID === "openai")
    expect(card?.badge).toEqual({ text: "UNHEALTHY", tone: "warning" })
    expect(card?.bodyLines).toContain("unhealthy (quota_exceeded)")
  })

  it("#given a disabled provider that is also unhealthy #when building cards #then DISABLED wins", () => {
    // given
    const cache = cacheWith({ openai: ["gpt-5.5"] }, ["openai"])
    const toggles = togglesWith("openai")
    const healthNote = () => "unhealthy (quota_exceeded)"

    // when
    const cards = buildProviderCards({ toggles, cache, healthNote })

    // then
    const card = cards.find((entry) => entry.providerID === "openai")
    expect(card?.badge).toEqual({ text: "DISABLED", tone: "negative" })
  })

  it("#given a health snapshot with an expired cooldown #when reading health note #then returns undefined", () => {
    // given
    const snapshot: ProviderHealthSnapshot = { openai: { reason: "quota_exceeded", unavailableUntil: 100 } }

    // when
    const note = providerHealthNote(snapshot, "openai", 200)

    // then
    expect(note).toBeUndefined()
  })

  it("#given a health snapshot with an active cooldown #when reading health note #then returns the reason", () => {
    // given
    const snapshot: ProviderHealthSnapshot = { openai: { reason: "quota_exceeded", unavailableUntil: 300 } }

    // when
    const note = providerHealthNote(snapshot, "openai", 200)

    // then
    expect(note).toBe("unhealthy (quota_exceeded)")
  })

  it("#given a provider absent from the cache #when reading model count #then returns undefined", () => {
    // given
    const cache = cacheWith({ openai: ["gpt-5.5"] }, ["openai"])

    // when
    const count = providerModelCount(cache, "anthropic")

    // then
    expect(count).toBeUndefined()
  })

  it("#given a provider in the cache #when reading model count #then returns its length", () => {
    // given
    const cache = cacheWith({ openai: ["gpt-5.5", "gpt-5.6"] }, ["openai"])

    // when
    const count = providerModelCount(cache, "openai")

    // then
    expect(count).toBe(2)
  })

  it("#given a disabled provider #when computing badge #then returns DISABLED negative", () => {
    // when
    const badge = providerBadge(true, undefined)

    // then
    expect(badge).toEqual({ text: "DISABLED", tone: "negative" })
  })

  it("#given an unhealthy provider #when computing badge #then returns UNHEALTHY warning", () => {
    // when
    const badge = providerBadge(false, "unhealthy (quota_exceeded)")

    // then
    expect(badge).toEqual({ text: "UNHEALTHY", tone: "warning" })
  })

  it("#given a healthy provider #when computing badge #then returns HEALTHY positive", () => {
    // when
    const badge = providerBadge(false, undefined)

    // then
    expect(badge).toEqual({ text: "HEALTHY", tone: "positive" })
  })
})
