import { describe, expect, it } from "bun:test"
import { registerToolHooks } from "./tool-hook-bridge"
import { createRegistrationCollector } from "./registration-collector"
import {
  createHookBridgeTestHarness,
  fireRegistration,
  registrationsFor,
  syntheticHandlers,
} from "./hook-bridge.test-support"

describe("registerToolHooks", () => {
  it("flows tool.execute.before args mutations and replacements back into e.input", async () => {
    // given
    const harness = createHookBridgeTestHarness()
    const collector = createRegistrationCollector()
    let toggle = false
    const hooks = syntheticHandlers({
      "tool.execute.before": async (_input, output) => {
        if (!toggle) {
          output.args.command = "MUTATED"
        } else {
          output.args = { command: "REPLACED", extra: 1 }
        }
        toggle = true
      },
    })
    await registerToolHooks(harness.ctx, hooks, collector)
    const beforeHook = registrationsFor(harness, "tool", "execute.before")[0]!

    // when + then — in-place mutation
    const event = { tool: "bash", sessionID: "sess-1", agent: "build", messageID: "msg-1", id: "call_1", input: { command: "ls" } }
    await fireRegistration(beforeHook, event)
    expect((event.input as { command: string }).command).toBe("MUTATED")

    // when + then — reference replacement
    const replacedEvent = { tool: "bash", sessionID: "sess-1", agent: "build", messageID: "msg-1", id: "call_2", input: { command: "ls" } }
    await fireRegistration(beforeHook, replacedEvent)
    expect(replacedEvent.input as Record<string, unknown>).toEqual({ command: "REPLACED", extra: 1 })
  })

  it("flows tool.execute.after output and metadata back into the V2 result", async () => {
    // given
    const harness = createHookBridgeTestHarness()
    const collector = createRegistrationCollector()
    await registerToolHooks(harness.ctx, syntheticHandlers(), collector)
    const afterHook = registrationsFor(harness, "tool", "execute.after")[0]!
    const event = {
      tool: "bash",
      sessionID: "sess-1",
      agent: "build",
      messageID: "msg-1",
      id: "call_1",
      input: { command: "ls" },
      status: "completed" as const,
      result: { content: "out" } as { content?: string | ReadonlyArray<unknown>; metadata?: Record<string, unknown> },
    }

    // when
    await fireRegistration(afterHook, event)

    // then
    expect(event.result.content).toBe("out\nGUIDANCE")
    expect(event.result.metadata?.["flag"]).toBe(true)
  })

  it("applies tool.definition description overrides via editor.update", async () => {
    // given
    const harness = createHookBridgeTestHarness()
    const collector = createRegistrationCollector()
    await registerToolHooks(harness.ctx, syntheticHandlers(), collector)

    // when
    const updates: Array<{ id: string; description: string }> = []
    harness.transformCalls[0]?.({
      list: () => [
        { id: "todowrite", name: "todowrite", description: "original", input: { type: "object", properties: {} } },
        { id: "bash", name: "bash", description: "bash", input: { type: "object", properties: {} } },
      ],
      update: (id: string, update: (tool: { description: string; input: unknown }) => void) => {
        const editable = { description: id === "todowrite" ? "original" : "bash", input: { type: "object", properties: {} } }
        update(editable)
        updates.push({ id, description: editable.description })
      },
    })

    // then
    expect(updates).toEqual([{ id: "todowrite", description: "OVERRIDE" }])
  })
})
