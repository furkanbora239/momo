import { describe, it, expect } from "bun:test"
import {
  buildEffortQuestion,
  buildLaneQuestion,
  buildModelQuestion,
  buildPathQuestion,
} from "./schema"
import type { ChoiceQuestion, ScoreQuestion } from "./types"

describe("schema builders", () => {
  it("buildPathQuestion produces a criteria dict keyed by option name", () => {
    const question = buildPathQuestion([
      { name: "a", description: "da" },
      { name: "b", description: "db" },
    ])

    expect(question.type).toBe("choice")
    const choice = question as ChoiceQuestion
    expect(Array.isArray(choice.criteria)).toBe(false)
    expect(choice.criteria).toEqual({ a: "da", b: "db" })
  })

  it("buildEffortQuestion produces an ordered score level array", () => {
    const question = buildEffortQuestion()

    expect(question.type).toBe("score")
    const score = question as ScoreQuestion
    expect(Array.isArray(score.criteria)).toBe(true)
    expect(score.criteria.length).toBe(5)
    expect(score.criteria[0]).toBe("1 - trivial")
    expect(score.criteria[4]).toBe("5 - very hard")
  })

  it("buildModelQuestion maps candidates to a criteria dict", () => {
    const question = buildModelQuestion([
      { name: "hy3", priceLine: "free", strength: "fast" },
    ])

    expect(question.type).toBe("choice")
    const choice = question as ChoiceQuestion
    expect(choice.criteria["hy3"]).toBe("free; fast")
  })

  it("buildLaneQuestion produces a two-key criteria dict", () => {
    const question = buildLaneQuestion()

    expect(question.type).toBe("choice")
    const choice = question as ChoiceQuestion
    expect(Object.keys(choice.criteria)).toEqual([
      "direct-worker",
      "department",
    ])
  })
})
