/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import { createLibrarianAgent } from "./librarian"

// Wave 5 lean-prompt budget: the pre-Wave-5 librarian prompt measured 9786 chars
// (2026). The rewritten prompt must stay at or under 50% of that length.
const PRE_WAVE5_LIBRARIAN_PROMPT_LENGTH = 9786
const LIBRARIAN_PROMPT_LENGTH_CEILING = Math.floor(PRE_WAVE5_LIBRARIAN_PROMPT_LENGTH * 0.5)

const TEST_MODEL = "anthropic/claude-sonnet-4-5"
const REMOVED_CLASSIFICATION_MARKERS = ["TYPE A", "TYPE B", "TYPE C", "TYPE D", "PHASE"] as const

describe("librarian agent prompt shape (Wave 5 lean prompts)", () => {
  test("prompt stays under the lean length ceiling", () => {
    // given
    const agent = createLibrarianAgent(TEST_MODEL)

    // when
    const promptLength = agent.prompt.length

    // then
    expect(promptLength).toBeLessThanOrEqual(LIBRARIAN_PROMPT_LENGTH_CEILING)
  })

  test("prompt keeps the <results> output contract and permalink evidence markers", () => {
    // given
    const agent = createLibrarianAgent(TEST_MODEL)

    // when
    const prompt = agent.prompt

    // then
    expect(prompt).toContain("<results>")
    expect(prompt).toContain("</results>")
    expect(prompt).toContain("permalink")
  })

  test("prompt drops the TYPE A-D classification and phase scaffolding", () => {
    // given
    const agent = createLibrarianAgent(TEST_MODEL)

    // when
    const prompt = agent.prompt

    // then
    for (const marker of REMOVED_CLASSIFICATION_MARKERS) {
      expect(prompt).not.toContain(marker)
    }
  })
})
