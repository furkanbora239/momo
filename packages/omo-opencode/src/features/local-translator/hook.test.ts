import { describe, expect, it } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk"
import { createLocalTranslatorHook } from "./hook"

function makeUserMessage(text: string) {
  return {
    info: {
      id: "m1",
      sessionID: "s1",
      role: "user",
      time: { created: 1 },
    } as unknown as Message,
    parts: [{ type: "text", text } as unknown as Part],
  }
}

describe("local-translator hook", () => {
  it("skips a short message before any Ollama call (text unchanged)", async () => {
    const hook = createLocalTranslatorHook({
      enabled: true,
      minLength: 20,
      logTranslations: false,
      ollamaHost: "http://localhost:99999",
    })
    const output = { messages: [makeUserMessage("ok")] }

    await hook["experimental.chat.messages.transform"]({}, output)

    expect((output.messages[0].parts[0] as { text: string }).text).toBe("ok")
  })

  it("leaves text unchanged when translation is disabled", async () => {
    const hook = createLocalTranslatorHook({
      enabled: false,
      logTranslations: false,
      ollamaHost: "http://localhost:99999",
    })
    const output = { messages: [makeUserMessage("bu uzun bir test mesaji olmali")] }

    await hook["experimental.chat.messages.transform"]({}, output)

    expect((output.messages[0].parts[0] as { text: string }).text).toBe(
      "bu uzun bir test mesaji olmali",
    )
  })

  it("does not throw and leaves text unchanged when no user message is present", async () => {
    const hook = createLocalTranslatorHook({
      enabled: true,
      logTranslations: false,
      ollamaHost: "http://localhost:99999",
    })
    const output = {
      messages: [
        {
          info: {
            id: "a1",
            sessionID: "s1",
            role: "assistant",
            time: { created: 1 },
          } as unknown as Message,
          parts: [{ type: "text", text: "thinking" } as unknown as Part],
        },
      ],
    }

    await hook["experimental.chat.messages.transform"]({}, output)

    expect((output.messages[0].parts[0] as { text: string }).text).toBe("thinking")
  })
})
