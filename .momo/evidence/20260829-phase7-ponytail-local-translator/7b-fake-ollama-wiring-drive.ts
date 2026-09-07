import { createTransformHooks } from "/home/furkanbora/code/ai/omo/packages/omo-opencode/src/plugin/hooks/create-transform-hooks"
import { createMessagesTransformHandler } from "/home/furkanbora/code/ai/omo/packages/omo-opencode/src/plugin/messages-transform"
import { unsafeTestValue } from "/home/furkanbora/code/ai/omo/test-support/unsafe-test-value"

const state = { tagsHits: 0, chatHits: 0, chatBodies: [] as string[] }

const server = Bun.serve({
  port: 0,
  hostname: "127.0.0.1",
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/api/tags") {
      state.tagsHits += 1
      return new Response(JSON.stringify({ models: [{ name: "qwen2.5:1.5b" }] }), {
        headers: { "Content-Type": "application/json" },
      })
    }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      state.chatHits += 1
      state.chatBodies.push(await request.text())
      return new Response(
        JSON.stringify({ message: { role: "assistant", content: "Translate then compress: drop filler. Keep code/paths exact. Fragments ok. Output only result." }, done: true }),
        { headers: { "Content-Type": "application/json" } },
      )
    }
    return new Response("not found", { status: 404 })
  },
})

const port = server.port
console.log("== scenario 1: enabled + reachable fake Ollama (real wiring path) ==")
const enabledHooks = createTransformHooks({
  ctx: unsafeTestValue({ directory: process.cwd(), client: {} }),
  pluginConfig: unsafeTestValue({
    local_translator: {
      ollama_host: `http://127.0.0.1:${port}`,
      auto_install: false,
      min_length: 5,
      timeout_ms: 2000,
      log_translations: false,
    },
  }),
  isHookEnabled: () => true,
})
console.log("localTranslator wired:", enabledHooks.localTranslator !== null)
const enabledHandler = createMessagesTransformHandler({
  hooks: unsafeTestValue({ localTranslator: enabledHooks.localTranslator }),
})
const out1 = {
  messages: [
    {
      info: { id: "msg_1", role: "user", sessionID: "ses_1" },
      parts: [{ type: "text", text: "merhaba, bu mesaji ingilizceye cevir ve token verimli hale getir" }],
    },
  ],
}
await enabledHandler({}, unsafeTestValue(out1))
console.log("user text after handler:", (out1.messages[0] as any).parts[0].text)
console.log("fake /api/chat hits:", state.chatHits)

console.log("\n== scenario 2: disabled via config ==")
const disabledHooks = createTransformHooks({
  ctx: unsafeTestValue({ directory: process.cwd(), client: {} }),
  pluginConfig: unsafeTestValue({ local_translator: { enabled: false } }),
  isHookEnabled: () => true,
})
console.log("localTranslator wired:", disabledHooks.localTranslator !== null)
const disabledHandler = createMessagesTransformHandler({
  hooks: unsafeTestValue({ localTranslator: disabledHooks.localTranslator }),
})
const out2 = {
  messages: [
    {
      info: { id: "msg_2", role: "user", sessionID: "ses_2" },
      parts: [{ type: "text", text: "bu mesaj aynen kalacak" }],
    },
  ],
}
const chatHitsBefore = state.chatHits
await disabledHandler({}, unsafeTestValue(out2))
console.log("user text after handler:", (out2.messages[0] as any).parts[0].text)
console.log("extra chat hits:", state.chatHits - chatHitsBefore)

console.log("\n== scenario 3: short message below min_length (no Ollama call) ==")
const chatHitsBefore2 = state.chatHits
const tagsHitsBefore2 = state.tagsHits
const out3 = {
  messages: [
    {
      info: { id: "msg_3", role: "user", sessionID: "ses_3" },
      parts: [{ type: "text", text: "ok" }],
    },
  ],
}
await enabledHandler({}, unsafeTestValue(out3))
console.log("user text after handler:", (out3.messages[0] as any).parts[0].text)
console.log("extra chat hits:", state.chatHits - chatHitsBefore2)
console.log("extra tags hits:", state.tagsHits - tagsHitsBefore2)

console.log("\n== fake /api/chat request body (system prompt + options) ==")
const body = JSON.parse(state.chatBodies[0])
console.log("model:", body.model)
console.log("options:", JSON.stringify(body.options))
console.log("system prompt:", body.messages[0].content.slice(0, 120) + "...")
console.log("user content:", body.messages[1].content)

server.stop(true)
