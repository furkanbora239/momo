import { describe, expect, test } from "bun:test"
import { nativeAdvisorPoolAfterToggle, nativePoolModelCards, nativeProviderCards } from "./catalog-controls"

const refs = [
  { providerID: "local", id: "cheap" },
  { providerID: "remote", id: "premium" },
]

describe("native catalog TUI controls", () => {
  test("advisor toggles update the exact native model refs", () => {
    expect(nativeAdvisorPoolAfterToggle([], refs[0]!)).toEqual([refs[0]])
    expect(nativeAdvisorPoolAfterToggle(refs, refs[0]!)).toEqual([refs[1]])
  })

  test("model cards show live price certainty, allowed state, and advisor eligibility", () => {
    const cards = nativePoolModelCards([
      { ...refs[0]!, available: true, inputPricePerMillion: 0, outputPricePerMillion: 0 },
      { ...refs[1]!, available: true },
    ], { version: 1, allowed: [{ providerID: refs[0]!.providerID, modelID: refs[0]!.id }], updatedAt: "" }, [refs[1]!])

    expect(cards[0]).toMatchObject({ badge: { text: "ALLOWED" }, bodyLines: ["general pool only", "in $0.00 / out $0.00 per M"] })
    expect(cards[1]).toMatchObject({ badge: { text: "EXCLUDED" }, bodyLines: ["advisor eligible", "price unknown"] })
  })

  test("provider cards derive visible toggle state without exposing credentials", () => {
    const cards = nativeProviderCards(["local", "remote"], { version: 1, disabled: ["REMOTE"], updatedAt: "" })

    expect(cards.map(({ providerID, disabled, bodyLines }) => ({ providerID, disabled, bodyLines }))).toEqual([
      { providerID: "local", disabled: false, bodyLines: ["available to native model catalog"] },
      { providerID: "remote", disabled: true, bodyLines: ["excluded from native model catalog"] },
    ])
  })
})
