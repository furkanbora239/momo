/// <reference types="bun-types" />

import { describe, test, expect } from "bun:test"
import { createExploreAgent } from "./explore"

// Wave 5 lean-prompt budget: the pre-Wave-5 explore prompt measured 2581 chars
// (2026). The rewritten prompt must stay at or under 55% of that length.
const PRE_WAVE5_EXPLORE_PROMPT_LENGTH = 2581
const EXPLORE_PROMPT_LENGTH_CEILING = Math.floor(PRE_WAVE5_EXPLORE_PROMPT_LENGTH * 0.55)

const TEST_MODEL = "anthropic/claude-sonnet-4-5"
const OUTPUT_CONTRACT_MARKERS = [
  "<results>",
  "</results>",
  "<files>",
  "</files>",
  "<answer>",
  "</answer>",
  "<next_steps>",
  "</next_steps>",
  "/absolute/path/to/",
] as const

describe("explore agent prompt shape (Wave 5 lean prompts)", () => {
  test("prompt stays under the lean length ceiling", () => {
    // given
    const agent = createExploreAgent(TEST_MODEL)

    // when
    const promptLength = agent.prompt.length

    // then
    expect(promptLength).toBeLessThanOrEqual(EXPLORE_PROMPT_LENGTH_CEILING)
  })

  test("prompt keeps the <results> output contract markers", () => {
    // given
    const agent = createExploreAgent(TEST_MODEL)

    // when
    const prompt = agent.prompt

    // then
    for (const marker of OUTPUT_CONTRACT_MARKERS) {
      expect(prompt).toContain(marker)
    }
  })

  test("prompt drops the <analysis> intent ceremony", () => {
    // given
    const agent = createExploreAgent(TEST_MODEL)

    // when
    const prompt = agent.prompt

    // then
    expect(prompt).not.toContain("<analysis>")
  })
})
