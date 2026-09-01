import { describe, expect, it } from "bun:test"

import { createTransformHooks } from "../../plugin/hooks/create-transform-hooks"
import { createMessagesTransformHandler } from "../../plugin/messages-transform"
import type { PluginContext } from "../../plugin/types"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

type TransformPart = {
  type: string
  text?: string
  synthetic?: boolean
}

type TransformMessage = {
  info: { id: string; role: string; sessionID?: string }
  parts: TransformPart[]
}

function createCtx(directory: string): PluginContext {
  return unsafeTestValue({ directory, client: {} })
}

function createUserMessage(sessionID: string, text: string): TransformMessage {
  return {
    info: { id: `msg_${sessionID}`, role: "user", sessionID },
    parts: [{ type: "text", text }],
  }
}

async function startFakeOllama(
  host: { port: number },
  hits: { chat: number; tags: number },
) {
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url)
      if (request.method === "GET" && url.pathname === "/api/tags") {
        hits.tags += 1
        return new Response(JSON.stringify({ models: [{ name: "qwen2.5:1.5b" }] }), {
          headers: { "Content-Type": "application/json" },
        })
      }
      if (request.method === "POST" && url.pathname === "/api/chat") {
        hits.chat += 1
        return new Response(
          JSON.stringify({
            message: { role: "assistant", content: "COMPRESSED_EN" },
            done: true,
          }),
          { headers: { "Content-Type": "application/json" } },
        )
      }
      return new Response("not found", { status: 404 })
    },
  })
  host.port = server.port
  return server
}

describe("local translator through the transform wiring", () => {
  it("#given local_translator enabled with a reachable fake Ollama #when the messages transform handler runs #then the user text is replaced with the fake translation", async () => {
    // given
    const host = { port: 0 }
    const hits = { chat: 0, tags: 0 }
    const server = await startFakeOllama(host, hits)
    try {
      const transformHooks = createTransformHooks({
        ctx: createCtx(process.cwd()),
        pluginConfig: unsafeTestValue({
          local_translator: {
            mode: "local",
            ollama_host: `http://127.0.0.1:${host.port}`,
            auto_install: false,
            min_length: 5,
            timeout_ms: 2000,
            log_translations: false,
          },
        }),
        isHookEnabled: () => true,
      })
      expect(transformHooks.localTranslator).not.toBeNull()
      const handler = createMessagesTransformHandler({
        hooks: unsafeTestValue({ localTranslator: transformHooks.localTranslator }),
      })

      // when
      const output = {
        messages: [createUserMessage("ses_lt_a", "bu mesaj ingilizceye cevrilsin")],
      }
      await handler({}, unsafeTestValue(output))

      // then
      expect(hits.chat).toBe(1)
      expect(output.messages[0]!.parts[0]!.text).toBe("COMPRESSED_EN")
    } finally {
      server.stop(true)
    }
  })

  it("#given local_translator disabled #when the transform hooks are composed #then no translator is registered and the transform is a no-op", async () => {
    // given
    const transformHooks = createTransformHooks({
      ctx: createCtx(process.cwd()),
      pluginConfig: unsafeTestValue({ local_translator: { enabled: false } }),
      isHookEnabled: () => true,
    })
    expect(transformHooks.localTranslator).toBeNull()
    const handler = createMessagesTransformHandler({
      hooks: unsafeTestValue({ localTranslator: transformHooks.localTranslator }),
    })

    // when
    const output = {
      messages: [createUserMessage("ses_lt_b", "bu mesaj ingilizceye cevrilsin")],
    }
    await handler({}, unsafeTestValue(output))

    // then
    expect(output.messages[0]!.parts).toHaveLength(1)
    expect(output.messages[0]!.parts[0]!.text).toBe("bu mesaj ingilizceye cevrilsin")
  })

  it("#given local_translator enabled but the message is below min_length #when the messages transform handler runs #then the message is unchanged and no Ollama call is made", async () => {
    // given
    const host = { port: 0 }
    const hits = { chat: 0, tags: 0 }
    const server = await startFakeOllama(host, hits)
    try {
      const transformHooks = createTransformHooks({
        ctx: createCtx(process.cwd()),
        pluginConfig: unsafeTestValue({
          local_translator: {
            mode: "local",
            ollama_host: `http://127.0.0.1:${host.port}`,
            auto_install: false,
            min_length: 20,
            timeout_ms: 2000,
            log_translations: false,
          },
        }),
        isHookEnabled: () => true,
      })
      const handler = createMessagesTransformHandler({
        hooks: unsafeTestValue({ localTranslator: transformHooks.localTranslator }),
      })

      // when
      const output = {
        messages: [createUserMessage("ses_lt_c", "ok")],
      }
      await handler({}, unsafeTestValue(output))

      // then
      expect(hits.chat).toBe(0)
      expect(hits.tags).toBe(0)
      expect(output.messages[0]!.parts[0]!.text).toBe("ok")
    } finally {
      server.stop(true)
    }
  })
})
