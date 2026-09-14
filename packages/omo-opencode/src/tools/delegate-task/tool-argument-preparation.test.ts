import { describe, expect, test } from "bun:test"
import { prepareDelegateTaskArgs } from "./tool-argument-preparation"
import type { ToolContextWithMetadata } from "./types"

const ctx: ToolContextWithMetadata = {
  sessionID: "ses_test",
  messageID: "msg_test",
  agent: "test",
  abort: new AbortController().signal,
}

const baseArgs = {
  prompt: "do the thing",
  subagent_type: "explore",
}

describe("prepareDelegateTaskArgs run_in_background resolution", () => {
  describe("#given run_in_background omitted and no config", () => {
    test("#when prepared #then resolves to false (sync)", async () => {
      const result = await prepareDelegateTaskArgs({ ...baseArgs }, ctx)

      expect(result.run_in_background).toBe(false)
    })
  })

  describe("#given run_in_background omitted and nonBlockingByDefault true", () => {
    test("#when prepared #then resolves to true (background)", async () => {
      const result = await prepareDelegateTaskArgs({ ...baseArgs }, ctx, {
        nonBlockingByDefault: true,
      })

      expect(result.run_in_background).toBe(true)
    })
  })

  describe("#given run_in_background omitted and nonBlockingByDefault false", () => {
    test("#when prepared #then resolves to false (sync)", async () => {
      const result = await prepareDelegateTaskArgs({ ...baseArgs }, ctx, {
        nonBlockingByDefault: false,
      })

      expect(result.run_in_background).toBe(false)
    })
  })

  describe("#given explicit run_in_background false and nonBlockingByDefault true", () => {
    test("#when prepared #then explicit false wins", async () => {
      const result = await prepareDelegateTaskArgs(
        { ...baseArgs, run_in_background: false },
        ctx,
        { nonBlockingByDefault: true },
      )

      expect(result.run_in_background).toBe(false)
    })
  })

  describe("#given explicit run_in_background true and nonBlockingByDefault false", () => {
    test("#when prepared #then explicit true wins", async () => {
      const result = await prepareDelegateTaskArgs(
        { ...baseArgs, run_in_background: true },
        ctx,
        { nonBlockingByDefault: false },
      )

      expect(result.run_in_background).toBe(true)
    })
  })
})
