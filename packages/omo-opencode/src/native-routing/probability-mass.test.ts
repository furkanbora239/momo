import { describe, expect, test } from "bun:test"
import { hasValidProbabilityMass } from "./probability-mass"
import { isJevAnswer } from "./jev-answer-validation"
import type { NativeCandidate } from "./types"

const model = { providerID: "fixture", id: "model" }
const candidate: NativeCandidate = { role: "worker", model, facts: { ...model, available: true }, knowledge: { model, known: false } }

describe("native probability mass", () => {
  test("accepts rounded decimal boundaries consistently with direct validation", () => {
    for (const mass of [0.99, 1, 1.01]) {
      const probabilities = mass <= 1 ? { "worker|fixture/model": mass } : { "worker|fixture/model": 0.51, "explore|fixture/model": 0.5 }
      expect(hasValidProbabilityMass(Object.values(probabilities))).toBe(true)
      expect(isJevAnswer({ role: "worker", model, confidence: 0.9, probabilities }, [candidate, { ...candidate, role: "explore" }])).toBe(true)
    }
  })

  test("rejects actual boundary violations and malformed values", () => {
    for (const values of [[], [0.989999], [0.51, 0.500001], [NaN], [Infinity], [-0.01, 1], [1.01], ["0.99"], [null]]) expect(hasValidProbabilityMass(values)).toBe(false)
  })

  test("accepts accumulated rounding with many valid entries", () => {
    expect(hasValidProbabilityMass(Array.from({ length: 255 }, () => 1 / 255))).toBe(true)
  })
})
