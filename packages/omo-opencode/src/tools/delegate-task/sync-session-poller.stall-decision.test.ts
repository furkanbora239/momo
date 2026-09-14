declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")

type DecisionInput = {
  stallElapsedMs?: number
  producing?: boolean
  hasRunningTool?: boolean
  toolElapsedMs?: number
  stallTimeoutMs?: number
  productionTimeoutMs?: number
  activeToolTimeoutMs?: number
}

function makeInput(overrides: DecisionInput) {
  return {
    stallElapsedMs: overrides.stallElapsedMs ?? 0,
    producing: overrides.producing ?? false,
    hasRunningTool: overrides.hasRunningTool ?? false,
    toolElapsedMs: overrides.toolElapsedMs ?? 0,
    stallTimeoutMs: overrides.stallTimeoutMs ?? 180_000,
    productionTimeoutMs: overrides.productionTimeoutMs ?? 720_000,
    activeToolTimeoutMs: overrides.activeToolTimeoutMs ?? 3_600_000,
  }
}

describe("decideStallActivity", () => {
  const { decideStallActivity } = require("./sync-session-poller")

  test("continues when producing under the production bound", () => {
    // given: a producing session with 10 minutes of no-signature-change
    const input = makeInput({ producing: true, stallElapsedMs: 600_000 })

    // when: deciding
    const decision = decideStallActivity(input)

    // then: continue with reason producing
    expect(decision).toEqual({ action: "continue", reason: "producing" })
  })

  test("stalls when producing beyond the production bound", () => {
    // given: a producing session with 13 minutes of no-signature-change
    const input = makeInput({ producing: true, stallElapsedMs: 780_000 })

    // when: deciding
    const decision = decideStallActivity(input)

    // then: stall with reason stall_detector
    expect(decision).toEqual({ action: "stall", reason: "stall_detector" })
  })

  test("stalls when not producing with no tool beyond the stall timeout", () => {
    // given: a non-producing session with no tool and 4 minutes of inactivity
    const input = makeInput({ stallElapsedMs: 240_000 })

    // when: deciding
    const decision = decideStallActivity(input)

    // then: stall with reason stall_detector
    expect(decision).toEqual({ action: "stall", reason: "stall_detector" })
  })

  test("continues when not producing and under the stall timeout", () => {
    // given: a non-producing session with no tool and 2 minutes of inactivity
    const input = makeInput({ stallElapsedMs: 120_000 })

    // when: deciding
    const decision = decideStallActivity(input)

    // then: continue with reason stall_detector
    expect(decision).toEqual({ action: "continue", reason: "stall_detector" })
  })

  test("continues when a running tool is within the active tool timeout", () => {
    // given: a running tool with 10 minutes elapsed
    const input = makeInput({ hasRunningTool: true, toolElapsedMs: 600_000 })

    // when: deciding
    const decision = decideStallActivity(input)

    // then: continue with reason active_tool
    expect(decision).toEqual({ action: "continue", reason: "active_tool" })
  })

  test("stalls when a running tool exceeds the active tool timeout", () => {
    // given: a running tool with 70 minutes elapsed
    const input = makeInput({ hasRunningTool: true, toolElapsedMs: 4_200_000 })

    // when: deciding
    const decision = decideStallActivity(input)

    // then: stall with reason stall_detector
    expect(decision).toEqual({ action: "stall", reason: "stall_detector" })
  })

  test("a running tool takes precedence over producing", () => {
    // given: a producing session with a running tool far beyond the stall timeout
    const input = makeInput({
      producing: true,
      hasRunningTool: true,
      toolElapsedMs: 1_000,
      stallElapsedMs: 780_000,
    })

    // when: deciding
    const decision = decideStallActivity(input)

    // then: continue with reason active_tool
    expect(decision).toEqual({ action: "continue", reason: "active_tool" })
  })
})
