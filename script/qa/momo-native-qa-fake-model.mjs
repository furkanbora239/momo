#!/usr/bin/env node
import http from "node:http"
import fs from "node:fs"
import { spawn } from "node:child_process"
import path from "node:path"
import { createHash } from "node:crypto"

const port = Number(process.env.MOMO_NATIVE_QA_FAKE_MODEL_PORT ?? 0)
const scriptPath = process.env.MOMO_NATIVE_QA_SCRIPT
const logPath = process.env.MOMO_NATIVE_QA_LOG
let script = scriptPath ? JSON.parse(fs.readFileSync(scriptPath, "utf8")) : []
let callNumber = 0
const consumedSteps = new Set()

if (process.argv.includes("--self-test")) {
  const child = spawn(process.execPath, [path.resolve(process.argv[1])], {
    env: { ...process.env, MOMO_NATIVE_QA_FAKE_MODEL_PORT: "0", MOMO_NATIVE_QA_SCRIPT: "", MOMO_NATIVE_QA_LOG: "" },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let output = ""
  child.stdout.on("data", (chunk) => { output += chunk.toString() })
  child.stderr.on("data", (chunk) => { output += chunk.toString() })
  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("fake model server startup timed out")), 5_000)
      child.stdout.on("data", (chunk) => {
        const match = chunk.toString().match(/127\.0\.0\.1:(\d+)/)
        if (!match) return
        clearTimeout(timeout)
        resolve(Number(match[1]))
      })
      child.once("exit", (code) => reject(new Error(`fake model server exited early (${code}): ${output}`)))
    })
    const base = `http://127.0.0.1:${port}/v1`
    const models = await fetch(`${base}/models`).then((response) => response.json())
    if (models.data?.[0]?.id !== "momo-qa-model") throw new Error("fake /models response was invalid")
    await fetch(`http://127.0.0.1:${port}/__qa/script`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify([
        { match: "MOMO_QA_TOOL_CALL", lastRole: "user", once: true, tool_calls: [{ name: "momo_task", arguments: { prompt: "child" } }] },
        { lastRole: "tool", text: "MOMO_QA_CHILD_DONE" },
      ]),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`fake script setup returned HTTP ${response.status}`)
    })
    const call = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "momo-qa-model", stream: true, messages: [{ role: "user", content: "MOMO_QA_TOOL_CALL" }], tools: [{ type: "function", function: { name: "momo_task", parameters: { type: "object" } } }] }),
    })
    const stream = await call.text()
    if (!call.ok || !stream.includes('"name":"momo_task"') || !stream.includes("child") || !stream.includes("[DONE]")) {
      throw new Error(`streaming fake tool-call response did not match the script (HTTP ${call.status}; ${stream.slice(0, 500)})`)
    }
    const followup = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "momo-qa-model", messages: [{ role: "tool", content: "child complete" }] }),
    }).then((response) => response.json())
    if (followup.choices?.[0]?.message?.content !== "MOMO_QA_CHILD_DONE") throw new Error("tool-result script step was not selected")
    process.stdout.write(JSON.stringify({ models: true, streamingToolCall: true, toolFollowup: true, callCount: 2 }) + "\n")
  } catch (error) {
    process.stderr.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  } finally {
    child.kill("SIGTERM")
    await new Promise((resolve) => child.once("exit", resolve))
  }
  process.exit(process.exitCode ?? 0)
}

function contentText(value) {
  if (typeof value === "string") return value
  if (Array.isArray(value)) return value.map((item) => item?.text ?? "").join("\n")
  return ""
}

function getRequestText(body) {
  return [
    ...(Array.isArray(body.messages) ? body.messages.map((message) => contentText(message.content)) : []),
    ...(Array.isArray(body.input) ? body.input.map((item) => contentText(item.content ?? item)) : []),
  ].join("\n")
}

function getLastMessage(body) {
  if (Array.isArray(body.messages)) return body.messages.at(-1) ?? {}
  if (Array.isArray(body.input)) return body.input.at(-1) ?? {}
  return {}
}

function record(entry) {
  if (!logPath) return
  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
}

function sendJson(response, body, status = 200) {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(body))
}

function sendChatCompletion(response, payload, streamed) {
  if (!streamed) return sendJson(response, payload)
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
  const choice = payload.choices[0]
  const deltas = []
  if (Array.isArray(choice.message.tool_calls)) {
    for (const [index, call] of choice.message.tool_calls.entries()) {
      deltas.push({ tool_calls: [{ index, id: call.id, type: "function", function: { name: call.function.name, arguments: call.function.arguments } }] })
    }
  } else if (choice.message.content) {
    deltas.push({ content: choice.message.content })
  }
  for (const delta of deltas) response.write(`data: ${JSON.stringify({ id: payload.id, object: "chat.completion.chunk", created: payload.created, model: payload.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
  response.write(`data: ${JSON.stringify({ id: payload.id, object: "chat.completion.chunk", created: payload.created, model: payload.model, choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason }] })}\n\n`)
  response.end("data: [DONE]\n\n")
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1")
  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, { healthy: true })
    return
  }
  if (request.method === "GET" && url.pathname.endsWith("/models")) {
    sendJson(response, { data: [{ id: "momo-qa-model", object: "model", created: 0, owned_by: "momo-qa" }] })
    return
  }
  if (request.method === "POST" && url.pathname === "/__qa/script") {
    let body = ""
    for await (const chunk of request) body += chunk
    try {
      const parsed = JSON.parse(body)
      if (!Array.isArray(parsed)) throw new Error("script must be a JSON array")
      script = parsed
      callNumber = 0
      consumedSteps.clear()
      sendJson(response, { accepted: script.length })
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : "invalid script" }, 400)
    }
    return
  }
  if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions") && !url.pathname.endsWith("/responses")) {
    sendJson(response, { error: "not found" }, 404)
    return
  }

  let raw = ""
  for await (const chunk of request) raw += chunk
  let body
  try {
    body = JSON.parse(raw)
  } catch (error) {
    sendJson(response, { error: error instanceof Error ? error.message : "invalid JSON" }, 400)
    return
  }
  const lastMessage = getLastMessage(body)
  const lastRole = lastMessage.role ?? lastMessage.type
  const lastText = contentText(lastMessage.content ?? lastMessage)
  const requestText = getRequestText(body)
  const history = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : []
  const lastUserMessage = [...history].reverse().find((message) => message.role === "user" || message.type === "message" && message.role === "user")
  const lastUserText = lastUserMessage ? contentText(lastUserMessage.content ?? lastUserMessage) : lastText
  const explicitSessionID = body.session_id ?? body.sessionID ?? body.metadata?.session_id ?? body.metadata?.sessionID ?? request.headers["x-opencode-session-id"]
  const sessionKey = typeof explicitSessionID === "string"
    ? explicitSessionID
    : createHash("sha256").update(lastUserText).digest("hex").slice(0, 16)
  const stepIndex = script.findIndex((candidate, index) => {
    if (consumedSteps.has(`${sessionKey}:${index}`)) return false
    if (candidate.model && candidate.model !== body.model) return false
    if (candidate.lastRole && candidate.lastRole !== lastRole) return false
    if (candidate.match && !requestText.includes(candidate.match)) return false
    if (candidate.lastContains && !lastText.includes(candidate.lastContains)) return false
    return true
  })
  const step = stepIndex >= 0 ? script[stepIndex] : undefined
  const index = ++callNumber
  record({ call: index, sessionKey, model: body.model ?? null, matched: step?.match ?? null, lastRole: lastRole ?? null, request: body })
  if (!step) {
    sendJson(response, { error: "no fake response matched", call: index }, 422)
    return
  }
  if (step.once) consumedSteps.add(`${sessionKey}:${stepIndex}`)

  if (url.pathname.endsWith("/responses")) {
    const output = []
    if (Array.isArray(step.tool_calls)) {
      for (const [toolIndex, call] of step.tool_calls.entries()) {
        output.push({ type: "function_call", id: `fc_${index}_${toolIndex}`, call_id: `call_${index}_${toolIndex}`, name: call.name, arguments: JSON.stringify(call.arguments ?? {}) })
      }
    } else {
      output.push({ type: "message", id: `msg_${index}`, role: "assistant", content: [{ type: "output_text", text: step.text ?? "DONE" }] })
    }
    sendJson(response, { id: `resp_${index}`, object: "response", status: "completed", model: body.model ?? "momo-qa-model", output, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } })
    return
  }

  const message = { role: "assistant", content: step.tool_calls?.length ? null : step.text ?? "DONE" }
  if (Array.isArray(step.tool_calls)) {
    message.tool_calls = step.tool_calls.map((call, toolIndex) => ({
      id: `call_${index}_${toolIndex}`,
      type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.arguments ?? {}) },
    }))
  }
  sendChatCompletion(response, {
    id: `chatcmpl_${index}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: body.model ?? "momo-qa-model",
    choices: [{ index: 0, message, finish_reason: message.tool_calls ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }, body.stream === true)
})

server.listen(port, "127.0.0.1", () => {
  const address = server.address()
  process.stdout.write(`fake model listening on 127.0.0.1:${address.port}\n`)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
