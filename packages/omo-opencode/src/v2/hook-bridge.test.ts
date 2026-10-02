import { describe, expect, it } from "bun:test"
import { registerV2Hooks } from "./hook-bridge"
import {
  createHookBridgeTestHarness,
  fireRegistration,
  registrationsFor,
  syntheticHandlers,
} from "./hook-bridge.test-support"

describe("registerV2Hooks", () => {
  it("collects every registration and disposes them all", async () => {
    // given
    const harness = createHookBridgeTestHarness()
    const bridge = await registerV2Hooks(harness.ctx, syntheticHandlers())
    expect(harness.registrations.length).toBeGreaterThan(0)

    // when
    await bridge.dispose()

    // then
    expect(harness.registrations.every((registration) => registration.disposed)).toBe(true)
  })

  it("keeps dispose/key ownership: no config or tool-definition registrations leak", async () => {
    // given
    const harness = createHookBridgeTestHarness()

    // when
    await registerV2Hooks(harness.ctx, syntheticHandlers())

    // then — the dispose/config/tool keys belong to the other bridges
    expect(registrationsFor(harness, "config", "config")).toEqual([])
    expect(harness.registrations.every((registration) => registration.hook !== "config")).toBe(true)
  })

  it("skips experimental.compaction.autocontinue with a single console.warn", async () => {
    // given
    const harness = createHookBridgeTestHarness()
    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (message?: unknown) => {
      warnings.push(String(message))
    }
    try {
      // when
      await registerV2Hooks(harness.ctx, {
        ...syntheticHandlers(),
        "experimental.compaction.autocontinue": async () => {},
      } as unknown as import("../testing/create-plugin-module").HooksWithRuntimeLifecycle)
    } finally {
      console.warn = originalWarn
    }

    // then — only the compacting hook is registered under the compaction domain
    const compactionHooks = registrationsFor(harness, "session", "compaction")
    expect(compactionHooks).toHaveLength(1)
    expect(warnings.some((warning) => warning.includes("experimental.compaction.autocontinue"))).toBe(true)
  })

  it("appends compaction context strings to the last user message of the V2 request", async () => {
    // given
    const harness = createHookBridgeTestHarness()
    await registerV2Hooks(harness.ctx, syntheticHandlers())
    const compactionHook = registrationsFor(harness, "session", "compaction")[0]!
    const userMessage = { id: "u1", role: "user", content: [{ type: "text", text: "compact me" }] }
    const event = {
      sessionID: "sess-1",
      agent: "build",
      model: { id: "glm", providerID: "opencode-go" },
      system: [],
      messages: [userMessage],
      options: {},
      tools: {},
    }

    // when
    await fireRegistration(compactionHook, event)

    // then
    expect(userMessage.content as Array<{ type: string; text?: string }>).toEqual([
      { type: "text", text: "compact me" },
      { type: "text", text: "COMPACT-CONTEXT" },
    ])
  })
})
