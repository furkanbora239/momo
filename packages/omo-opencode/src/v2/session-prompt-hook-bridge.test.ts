import { describe, expect, it } from "bun:test"
import { registerSessionPromptHooks } from "./session-prompt-hook-bridge"
import { createRegistrationCollector } from "./registration-collector"
import {
  createHookBridgeTestHarness,
  fireRegistration,
  registrationsFor,
  syntheticHandlers,
} from "./hook-bridge.test-support"

function contextWithHandlers(overrides: Parameters<typeof syntheticHandlers>[0]) {
  const harness = createHookBridgeTestHarness()
  const collector = createRegistrationCollector()
  const hooks = syntheticHandlers(overrides)
  return { harness, collector, hooks }
}

describe("registerSessionPromptHooks", () => {
  it("flows chat.message text mutations back into the V2 prompt", async () => {
    // given
    const { harness, collector, hooks } = contextWithHandlers({
      "chat.message": async (input, output) => {
        void input
        output.parts.push({ id: "synthetic_1", sessionID: "sess-1", messageID: "msg-1", type: "text", text: "INJECTED" })
      },
    })
    await registerSessionPromptHooks(harness.ctx, hooks, collector)
    const promptHooks = registrationsFor(harness, "session", "prompt")

    // when
    const event = { sessionID: "sess-1", messageID: "msg-1", prompt: { text: "hello" }, delivery: "queue" }
    await fireRegistration(promptHooks[1]!, event)

    // then — hydrated input view + parts write-back
    expect(promptHooks).toHaveLength(2)
    expect((event.prompt as { text: string }).text).toBe("helloINJECTED")
  })

  it("maps a slash prompt through the command bridge before chat.message", async () => {
    // given
    const { harness, collector, hooks } = contextWithHandlers({
      "command.execute.before": async (input, output) => {
        expect(input).toMatchObject({ command: "goal", sessionID: "sess-1", arguments: "fix it" })
        output.parts.push({ type: "text", text: "MARKER" })
      },
    })
    await registerSessionPromptHooks(harness.ctx, hooks, collector)
    const promptHooks = registrationsFor(harness, "session", "prompt")

    // when
    const event = { sessionID: "sess-1", messageID: "msg-1", prompt: { text: "/goal fix it" }, delivery: "queue" }
    await fireRegistration(promptHooks[0]!, event)

    // then
    expect((event.prompt as { text: string }).text).toBe("/goal fix itMARKER")
  })

  it("does not touch plain prompts in the command bridge", async () => {
    // given
    const { harness, collector, hooks } = contextWithHandlers({})
    await registerSessionPromptHooks(harness.ctx, hooks, collector)
    const promptHooks = registrationsFor(harness, "session", "prompt")

    // when
    const event = { sessionID: "sess-1", messageID: "msg-1", prompt: { text: "plain text" }, delivery: "queue" }
    await fireRegistration(promptHooks[0]!, event)

    // then
    expect((event.prompt as { text: string }).text).toBe("plain text")
  })
})
