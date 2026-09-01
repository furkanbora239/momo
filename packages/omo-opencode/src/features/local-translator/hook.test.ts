import { describe, expect, it } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Message, Part } from "@opencode-ai/sdk"
import { createLocalTranslatorHook } from "./hook"

const originalFetch = globalThis.fetch

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
      autoInstall: false,
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
      autoInstall: false,
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
      autoInstall: false,
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

  it("translates through the cloud backend when configured (mode: cloud)", async () => {
    process.env["GOOGLE_API_KEY"] = "test-key"
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ thought: true, text: "thoughts" }, { text: "COMPRESSED_EN" }],
              },
              finishReason: "STOP",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as unknown as typeof fetch
    try {
      const hook = createLocalTranslatorHook({
        enabled: true,
        mode: "cloud",
        logTranslations: false,
      })
      const output = { messages: [makeUserMessage("bu mesaj ingilizceye cevrilsin")] }

      await hook["experimental.chat.messages.transform"]({}, output)

      expect((output.messages[0].parts[0] as { text: string }).text).toBe("COMPRESSED_EN")
    } finally {
      globalThis.fetch = originalFetch
      delete process.env["GOOGLE_API_KEY"]
    }
  })

  it("passes the original text through in cloud mode when no API key exists", async () => {
    const savedEnv = {
      GOOGLE_API_KEY: process.env["GOOGLE_API_KEY"],
      GEMINI_API_KEY: process.env["GEMINI_API_KEY"],
      GOOGLE_GENERATIVE_AI_API_KEY: process.env["GOOGLE_GENERATIVE_AI_API_KEY"],
      XDG_DATA_HOME: process.env["XDG_DATA_HOME"],
    }
    for (const key of ["GOOGLE_API_KEY", "GEMINI_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"]) {
      delete process.env[key]
    }
    process.env["XDG_DATA_HOME"] = mkdtempSync(join(tmpdir(), "lt-no-auth-"))
    let fetchCalled = false
    globalThis.fetch = (async () => {
      fetchCalled = true
      return new Response("{}", { status: 200 })
    }) as unknown as typeof fetch
    try {
      const hook = createLocalTranslatorHook({
        enabled: true,
        mode: "cloud",
        logTranslations: false,
      })
      const text = "bu mesaj ingilizceye cevrilsin ve uzun olmali"
      const output = { messages: [makeUserMessage(text)] }

      await hook["experimental.chat.messages.transform"]({}, output)

      expect((output.messages[0].parts[0] as { text: string }).text).toBe(text)
      expect(fetchCalled).toBe(false)
    } finally {
      globalThis.fetch = originalFetch
      for (const [key, value] of Object.entries(savedEnv)) {
        if (typeof value === "string") process.env[key] = value
        else delete process.env[key]
      }
    }
  })
})
