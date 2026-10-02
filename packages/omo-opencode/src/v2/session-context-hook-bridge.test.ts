import { describe, expect, it } from "bun:test"
import { registerSessionContextHooks } from "./session-context-hook-bridge"
import { createRegistrationCollector } from "./registration-collector"
import {
  createHookBridgeTestHarness,
  fireRegistration,
  registrationsFor,
  syntheticHandlers,
} from "./hook-bridge.test-support"

function harnessWithHandlers(overrides: Parameters<typeof syntheticHandlers>[0]) {
  const harness = createHookBridgeTestHarness()
  const collector = createRegistrationCollector()
  const hooks = syntheticHandlers(overrides)
  return { harness, collector, hooks }
}

function syntheticContextEvent(overrides: Record<string, unknown> = {}): {
  sessionID: string
  agent: string
  model: { id: string; providerID: string }
  system: Array<{ type: string; text: string }>
  messages: unknown[]
  options: Record<string, unknown>
  tools: Record<string, never>
} {
  return {
    sessionID: "sess-1",
    agent: "build",
    model: { id: "glm", providerID: "opencode-go" },
    system: [],
    messages: [],
    options: {},
    tools: {},
    ...overrides,
  }
}

describe("registerSessionContextHooks", () => {
  it("writes chat.params mutations back into the V2 request options", async () => {
    // given
    const { harness, collector, hooks } = harnessWithHandlers({})
    await registerSessionContextHooks(harness.ctx, hooks, collector)
    const contextHooks = registrationsFor(harness, "session", "context")

    // when
    const event = syntheticContextEvent({ options: { temperature: 1 } })
    await fireRegistration(contextHooks[0]!, event)

    // then
    expect(contextHooks).toHaveLength(3)
    expect(event.options.temperature).toBe(0.4)
    expect(event.options.reasoningEffort).toBe("high")
  })

  it("appends system-transform strings as V2 system parts", async () => {
    // given
    const { harness, collector, hooks } = harnessWithHandlers({})
    await registerSessionContextHooks(harness.ctx, hooks, collector)
    const contextHooks = registrationsFor(harness, "session", "context")

    // when
    const event = syntheticContextEvent()
    await fireRegistration(contextHooks[1]!, event)

    // then
    expect(event.system).toEqual([{ type: "text", text: "SYNTHETIC-DIRECTIVE" }])
  })

  it("adapts messages-transform views and flows text, pushed messages and tool pairs back", async () => {
    // given
    const { harness, collector, hooks } = harnessWithHandlers({})
    const seen = {
      roles: [] as string[],
      firstUserText: undefined as string | undefined,
      toolStates: [] as string[],
    }
    await registerSessionContextHooks(harness.ctx, {
      ...hooks,
      "experimental.chat.messages.transform": async (_input, output) => {
        seen.roles = output.messages.map((message) => message.info.role)
        seen.firstUserText = output.messages[0]?.parts[0]?.type === "text" ? output.messages[0].parts[0].text : undefined
        seen.toolStates = output.messages
          .flatMap((message) => message.parts)
          .filter((part) => part.type === "tool")
          .map((part) => (part.state as { status: string }).status)
        const textPart = output.messages[0]?.parts[0]
        if (textPart !== undefined) (textPart as { text: string }).text = "TRANSLATED"
        output.messages.push({
          info: { id: "synthetic_msg", sessionID: "sess-1", role: "user", time: { created: 1 }, agent: "default", model: { providerID: "", modelID: "" } },
          parts: [{ id: "synthetic_part", sessionID: "sess-1", messageID: "synthetic_msg", type: "text", text: "REPO-MAP" }],
        })
      },
    } as unknown as typeof hooks, collector)
    const contextHooks = registrationsFor(harness, "session", "context")
    const toolMessage = { id: "t1", role: "tool", content: [{ type: "tool-result", id: "call_1", name: "bash", result: { type: "text", value: "out" } }] }
    const event = syntheticContextEvent({
      messages: [
        { id: "u1", role: "user", content: [{ type: "text", text: "hi" }] },
        { id: "a1", role: "assistant", content: [{ type: "tool-call", id: "call_1", name: "bash", input: { command: "ls" } }] },
        toolMessage,
      ],
    })

    // when
    await fireRegistration(contextHooks[2]!, event)

    // then
    expect(seen.roles).toEqual(["user", "assistant"])
    expect(seen.firstUserText).toBe("hi")
    expect(seen.toolStates).toEqual(["completed"])
    const messages = event.messages as Array<{ id?: string; role: string; content: Array<{ type: string; text?: string }> }>
    expect(messages[0]?.content[0]?.text).toBe("TRANSLATED")
    expect(messages[2]?.id).toBe("t1")
    expect(messages[3]?.content[0]?.text).toBe("REPO-MAP")
  })
})
