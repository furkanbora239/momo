import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawn, execFileSync } from "node:child_process"
import { createServer } from "node:net"
import { createServer as createHttpServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"
import { createNativeSessionRuntime } from "../../packages/omo-opencode/src/native-runtime/session-runtime"
import type { NativeTask, NativeTaskRepository } from "../../packages/omo-opencode/src/native-task/types"

const root = await mkdtemp(path.join(tmpdir(), "momo-native-plugin-probe-"))
const evidenceDir = process.env.MOMO_NATIVE_QA_EVIDENCE_DIR ?? path.join(process.cwd(), ".omo/evidence/20261011-native-engine/plugin-probe")
const qaHome = path.join(root, "home")
const xdg = {
  data: path.join(root, "xdg-data"),
  config: path.join(root, "xdg-config"),
  state: path.join(root, "xdg-state"),
  cache: path.join(root, "xdg-cache"),
}
const configDir = path.join(xdg.config, "opencode")
const pluginDir = path.join(root, ".opencode", "plugins")
const setupLog = path.join(root, "plugin-setup.jsonl")
const modelLog = path.join(root, "model-requests.jsonl")
const deniedMarker = path.join(root, "denied-shell-ran")
let opencode: ReturnType<typeof spawn> | undefined
let modelServer: ReturnType<typeof createHttpServer> | undefined
let opencodeOutput = ""
let modelPort = 0
let serverPort = 0
let dbBefore: Record<string, string> | undefined
let outcome: Record<string, unknown> | undefined

function isolatedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:API[_-]?KEY|_KEY$|_TOKEN$|_SECRET$|PASSWORD)/i.test(key)))
  return {
    ...clean,
    OPENCODE_TEST_HOME: qaHome,
    OPENCODE_CONFIG_DIR: configDir,
    XDG_DATA_HOME: xdg.data,
    XDG_CONFIG_HOME: xdg.config,
    XDG_STATE_HOME: xdg.state,
    XDG_CACHE_HOME: xdg.cache,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    NO_COLOR: "1",
    ...extra,
  }
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const socket = createServer()
    socket.once("error", reject)
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address()
      if (address === null || typeof address === "string") return reject(new Error("failed to reserve loopback port"))
      socket.close(() => resolve(address.port))
    })
  })
}

function realDatabaseCounts(): Record<string, string> | undefined {
  const realHome = process.env.HOME
  if (!realHome) return undefined
  const candidates = [
    path.join(realHome, "Library/Application Support/opencode/opencode.db"),
    path.join(realHome, ".local/share/opencode/opencode.db"),
  ]
  for (const dbPath of candidates) {
    if (!existsSync(dbPath)) continue
    try {
      const rows = execFileSync("sqlite3", ["-readonly", dbPath, "select 'session',count(*) from session union all select 'session_message',count(*) from session_message;"], { encoding: "utf8" }).trim().split("\n")
      return Object.fromEntries(rows.map((row) => row.split("|")))
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
  }
  throw new Error("could not read the real OpenCode database for a before/after safety check")
}

function json(response: import("node:http").ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json" })
  response.end(JSON.stringify(value))
}

async function startFakeModel(): Promise<void> {
  modelServer = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (request.method === "GET" && url.pathname.endsWith("/models")) {
      json(response, { data: [{ id: "momo-qa-model", object: "model", created: 0, owned_by: "momo-qa" }] })
      return
    }
    if (request.method !== "POST") {
      response.writeHead(404).end()
      return
    }
    let raw = ""
    for await (const chunk of request) raw += chunk.toString()
    const body = JSON.parse(raw) as { model?: string; stream?: boolean; messages?: Array<{ role?: string; content?: unknown }> }
    await appendFile(modelLog, `${JSON.stringify(body)}\n`, { mode: 0o600 })
    const lastRole = body.messages?.at(-1)?.role
    if (body.stream) {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
      const last = body.messages?.at(-1)
      const lastRole = last?.role
      const contentDelta = lastRole === "tool" ? { content: "MOMO_PERMISSION_DENIED_CONFIRMED" } : undefined
      const toolName = "shell"
      const call = { index: 0, id: "call_denial_probe", type: "function", function: { name: toolName, arguments: JSON.stringify({ command: `touch ${deniedMarker}`, description: "native permission probe" }) } }
      response.write(`data: ${JSON.stringify({ id: "momo-probe", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: contentDelta ?? { tool_calls: [call] }, finish_reason: null }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ id: "momo-probe", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: contentDelta ? "stop" : "tool_calls" }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ id: "momo-probe", object: "chat.completion.chunk", created: 1, model: body.model, choices: [], usage: { prompt_tokens: 31, completion_tokens: 9, total_tokens: 40 } })}\n\n`)
      response.end("data: [DONE]\n\n")
      return
    }
    json(response, { id: "momo-probe", object: "chat.completion", created: 1, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: lastRole === "tool" ? "MOMO_PERMISSION_DENIED_CONFIRMED" : null }, finish_reason: "stop" }], usage: { prompt_tokens: 31, completion_tokens: 9, total_tokens: 40 } })
  })
  modelPort = await new Promise<number>((resolve, reject) => {
    modelServer?.once("error", reject)
    modelServer?.listen(0, "127.0.0.1", () => {
      const address = modelServer?.address()
      if (address === null || address === undefined || typeof address === "string") return reject(new Error("fake provider did not bind"))
      resolve(address.port)
    })
  })
}

async function waitUntilReady(client: ReturnType<typeof OpenCode.make>, directory: string): Promise<void> {
  const deadline = Date.now() + 15_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await client.server.info()
      const providers = await client.provider.list({ location: { directory } })
      if (providers.data.some((provider) => provider.id === "momo-qa")) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`provider was not registered before timeout: ${String(lastError)}`)
}

async function main(): Promise<void> {
  dbBefore = realDatabaseCounts()
  for (const directory of [qaHome, ...Object.values(xdg), path.join(xdg.data, "opencode"), configDir, pluginDir]) await mkdir(directory, { recursive: true })
  await startFakeModel()
  serverPort = await freePort()
  const pluginPath = path.join(pluginDir, "momo-probe.ts")
  await writeFile(pluginPath, [
    'import { appendFileSync } from "node:fs"',
    'export default { id: "momo-native-probe", async setup(ctx) {',
    '  appendFileSync(process.env.MOMO_QA_SETUP_LOG, `${JSON.stringify({ setup: true })}\\n`)',
    '  await ctx.provider.transform((editor) => {',
    '    editor.add({ info: { id: "momo-qa", name: "Momo local fake", activation: "enabled", package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: process.env.MOMO_QA_MODEL_URL, apiKey: "local-only" } }, models: [{ id: "momo-qa-model", modelID: "momo-qa-model", providerID: "momo-qa", name: "Momo QA local", capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 }, cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }], status: "active", enabled: true, limit: { context: 8192, output: 2048 } }] })',
    '  })',
    '  await ctx.provider.reload()',
    '  await ctx.permission.hook("evaluate", (event) => {',
    '    const before = event.effect',
    '    if (event.action === "shell" || event.action === "bash") event.effect = "deny"',
    '    appendFileSync(process.env.MOMO_QA_SETUP_LOG, `${JSON.stringify({ action: event.action, before, after: event.effect, sessionID: event.sessionID, resources: event.resources })}\\n`)',
    '  })',
    '  await ctx.rpc.register({ id: "momo.native", methods: { tasks: { input: { type: "object", properties: { rootSessionID: { type: "string" } }, required: ["rootSessionID"] }, output: { type: "object", properties: { tasks: { type: "array", items: { type: "object" } } }, required: ["tasks"] } } }, events: {} }, { tasks: async () => ({ tasks: [] }) })',
    '}}',
  ].join("\n"), { mode: 0o600 })
  await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({
    "$schema": "https://opencode.ai/config.json",
    plugin: [pluginPath],
    model: "momo-qa/momo-qa-model",
    agent: "build",
  }, null, 2)}\n`, { mode: 0o600 })
  const servicePassword = `qa-${randomUUID()}`
  await writeFile(path.join(configDir, "service.json"), JSON.stringify({ password: servicePassword }), { mode: 0o600 })
  await writeFile(path.join(xdg.data, "opencode", "auth.json"), JSON.stringify({ "momo-qa": { type: "api", key: "local-only" } }), { mode: 0o600 })
  opencode = spawn("opencode", ["serve", "--service", "--hostname", "127.0.0.1", "--port", String(serverPort)], {
    cwd: root,
    env: isolatedEnv({ MOMO_QA_SETUP_LOG: setupLog, MOMO_QA_MODEL_URL: `http://127.0.0.1:${modelPort}/v1` }),
    stdio: ["ignore", "pipe", "pipe"],
  })
  opencode.stdout.on("data", (chunk: Buffer) => { opencodeOutput += chunk.toString() })
  opencode.stderr.on("data", (chunk: Buffer) => { opencodeOutput += chunk.toString() })
  const baseUrl = `http://127.0.0.1:${serverPort}`
  const authorization = `Basic ${Buffer.from(`opencode:${servicePassword}`).toString("base64")}`
  const client = OpenCode.make({ baseUrl, headers: { authorization } })
  await waitUntilReady(client, root)
  let plugins = await client.plugin.list({ location: { directory: root } })
  const pluginDeadline = Date.now() + 15_000
  while (!plugins.data.some((plugin) => plugin.id === "momo-native-probe" && plugin.state.status === "active") && Date.now() < pluginDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    plugins = await client.plugin.list({ location: { directory: root } })
  }
  if (!plugins.data.some((plugin) => plugin.id === "momo-native-probe" && plugin.state.status === "active")) {
    const config = await client.config.get({ location: { directory: root } })
    const providers = await client.provider.list({ location: { directory: root } })
    const setupRows = await Bun.file(setupLog).text().catch(() => "<missing>")
    throw new Error(`local plugin not reported active: ${JSON.stringify({ plugins: plugins.data, config, providers: providers.data.map((provider) => provider.id), setupRows })}`)
  }
  const setupRows = (await readFile(setupLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
  if (!setupRows.some((row) => row.setup === true)) throw new Error("plugin setup marker was not written")
  const session = await client.session.create({ location: { directory: root }, model: { providerID: "momo-qa", id: "momo-qa-model" } })
  await client.session.prompt({ sessionID: session.id, text: "MOMO_PERMISSION_DENY_PROBE" })
  await client.session.wait({ sessionID: session.id })
  const finalRows = (await readFile(setupLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
  if (!finalRows.some((row) => (row.action === "shell" || row.action === "bash") && row.after === "deny")) {
    const requests = await Bun.file(modelLog).text().catch(() => "<no fake provider request>")
    throw new Error(`native permission evaluation did not deny shell: ${JSON.stringify({ events: finalRows, requests })}`)
  }
  if (await Bun.file(deniedMarker).exists()) throw new Error("denied shell command created the marker")
  const requests = (await readFile(modelLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
  if (!requests.length) throw new Error("OpenCode did not call the local fake provider")
  const cliArgs = [
    "packages/omo-opencode/src/cli/index.ts", "run",
    "--attach", baseUrl,
    "--directory", root,
    "--agent", "build",
    "--model", "momo-qa/momo-qa-model",
    "--json",
    "MOMO_NATIVE_CLI_DENY_PROBE",
  ]
  const cli = spawn("bun", cliArgs, { cwd: process.cwd(), env: isolatedEnv({ OPENCODE_SERVER_PASSWORD: servicePassword, MOMO_QA_SETUP_LOG: setupLog, MOMO_QA_MODEL_URL: `http://127.0.0.1:${modelPort}/v1` }), stdio: ["ignore", "pipe", "pipe"] })
  let cliStdout = ""
  let cliStderr = ""
  cli.stdout.on("data", (chunk: Buffer) => { cliStdout += chunk.toString() })
  cli.stderr.on("data", (chunk: Buffer) => { cliStderr += chunk.toString() })
  let timeoutID: ReturnType<typeof setTimeout> | undefined
  const cliExit = await Promise.race([
    new Promise<number>((resolve, reject) => {
      cli.once("error", reject)
      cli.once("exit", (code) => resolve(code ?? 1))
    }),
    new Promise<number>((_, reject) => { timeoutID = setTimeout(() => {
      cli.kill("SIGKILL")
      reject(new Error("native CLI acceptance timed out"))
    }, 90_000) }),
  ])
  if (timeoutID !== undefined) clearTimeout(timeoutID)
  if (cliExit !== 0) throw new Error(`native CLI exited ${cliExit}: ${cliStderr}\n${cliStdout}`)
  const cliResult = JSON.parse(cliStdout.trim()) as { success?: boolean; sessionId?: string }
  if (cliResult.success !== true || typeof cliResult.sessionId !== "string") throw new Error(`native CLI result was unsuccessful: ${cliStdout}`)
  const cliRows = (await readFile(setupLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
  if (!cliRows.some((row) => row.sessionID === cliResult.sessionId && row.after === "deny")) throw new Error("native CLI did not exercise the real shell permission denial")
  if (await Bun.file(deniedMarker).exists()) throw new Error("CLI denied command created the marker")
  const taskID = "ntask_62d48f31-2a78-4f67-ae31-b513f02e74a1"
  const task: NativeTask = {
    id: taskID, rootTaskID: taskID, rootSessionID: session.id, parentSessionID: session.id,
    kind: "task", parentRole: "orchestrator", role: "worker", model: { providerID: "momo-qa", id: "momo-qa-model" },
    state: "running", prompt: "MOMO_NATIVE_RUNTIME_ACCEPTANCE", createdAt: Date.now(), updatedAt: Date.now(), attempts: 1,
    activeTools: [], childTaskIDs: [], processedEventIDs: [], lastActivityAt: Date.now(),
  }
  const tasks = new Map<string, NativeTask>()
  const repository: NativeTaskRepository = {
    get: async (id) => tasks.get(id), list: async () => [...tasks.values()], save: async (value) => { tasks.set(value.id, value) },
  }
  const parentInfo = await client.session.get({ sessionID: session.id })
  const runtime = createNativeSessionRuntime({
    client, repository, resolveOwnedRole: (info) => info.agent === "build" ? "orchestrator" : info.agent === "momo-worker" ? "worker" : undefined,
    resolveOwnedAgentID: () => "build",
    verifySessionOwner: async (info) => {
      const authoritative = await client.session.get({ sessionID: info.id })
      if (authoritative.id !== info.id || authoritative.projectID !== parentInfo.projectID || authoritative.location.directory !== root) throw new Error("runtime QA service ownership mismatch")
    },
    onParentAnswer: async (answeredTask, questionID, answer, replyingSessionID) => { if (answeredTask !== taskID || questionID !== "runtime-question" || replyingSessionID !== session.id || !answer) throw new Error("native form answer did not reach the durable callback") },
    onEvent: async () => undefined,
  })
  const allocated = await runtime.createSession({ taskID, rootSessionID: session.id, parentSessionID: session.id, role: "worker", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  task.sessionID = allocated.sessionID
  await repository.save(task)
  await runtime.start({ sessionID: allocated.sessionID, prompt: "MOMO_NATIVE_RUNTIME_ACCEPTANCE" })
  await client.session.wait({ sessionID: allocated.sessionID })
  const runtimeInspection = await runtime.inspect(allocated.sessionID)
  if (runtimeInspection.state !== "succeeded" || !runtimeInspection.result?.includes("MOMO_PERMISSION_DENIED_CONFIRMED")) throw new Error(`native runtime child did not complete through the fake provider: ${JSON.stringify(runtimeInspection)}`)
  if (runtimeInspection.usage === undefined || runtimeInspection.usage.inputTokens <= 0 || runtimeInspection.usage.outputTokens <= 0 || runtimeInspection.usage.scope !== "session_cumulative") throw new Error(`native runtime did not expose actual fake-provider usage: ${JSON.stringify(runtimeInspection)}`)
  await runtime.deliver({ parentSessionID: session.id, taskID, result: "MOMO_NATIVE_SYNTHETIC_DELIVERY" })
  let syntheticPersisted = false
  const deliveryDeadline = Date.now() + 10_000
  while (!syntheticPersisted && Date.now() < deliveryDeadline) {
    const deliveryRows = await client.session.inbox.list({ sessionID: session.id })
    const context = await client.session.context({ sessionID: session.id })
    syntheticPersisted = deliveryRows.some((item) => item.type === "synthetic" && item.payload.text.includes("MOMO_NATIVE_SYNTHETIC_DELIVERY"))
      || context.some((message) => message.type === "synthetic" && message.text.includes("MOMO_NATIVE_SYNTHETIC_DELIVERY"))
    if (!syntheticPersisted) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!syntheticPersisted) throw new Error("native synthetic result was not persisted in the parent inbox or transcript")
  await runtime.ask({ parentSessionID: session.id, taskID, question: { id: "runtime-question", prompt: "Runtime acceptance", form: { fields: [{ key: "answerKey", title: "Answer", type: "string", required: true }] } } })
  const nativeForms = await client.session.form.list({ sessionID: session.id })
  const runtimeForm = nativeForms.find((form) => form.title === "Runtime acceptance")
  if (runtimeForm === undefined) throw new Error("native runtime question form was not persisted")
  await client.session.form.reply({ sessionID: session.id, formID: runtimeForm.id, answer: { answerKey: "accepted" } })
  await runtime.onFormEvent({ id: "runtime-form-reply", created: Date.now(), type: "form.replied", data: { id: runtimeForm.id, sessionID: session.id, answer: { answerKey: "accepted" } } })
  const finalRequests = (await readFile(modelLog, "utf8")).trim().split("\n").filter(Boolean)
  outcome = { version: execFileSync("opencode", ["--version"], { cwd: root, env: isolatedEnv(), encoding: "utf8" }).trim(), providerID: "momo-qa", modelID: "momo-qa-model", pluginID: "momo-native-probe", pluginStatus: "active", apiSessionID: session.id, cliSessionID: cliResult.sessionId, cliResult, nativeRuntime: { childSessionID: allocated.sessionID, inspection: runtimeInspection, syntheticDeliveryPersisted: syntheticPersisted, nativeFormID: runtimeForm.id, nativeFormAnswerCallback: "accepted" }, permissionEvents: cliRows.filter((row) => row.action === "shell"), deniedCommandMarkerCreated: false, fakeModelRequests: finalRequests.length }
}

try {
  await main()
} catch (error) {
  outcome = { failure: error instanceof Error ? error.message : String(error), opencodeOutput: opencodeOutput.slice(-5000) }
  process.exitCode = 1
} finally {
  if (opencode && opencode.exitCode === null) {
    opencode.kill("SIGTERM")
    await new Promise((resolve) => opencode?.once("exit", resolve))
  }
  if (modelServer?.listening) await new Promise<void>((resolve) => modelServer?.close(() => resolve()))
  await mkdir(evidenceDir, { recursive: true })
  const after = dbBefore === undefined ? undefined : realDatabaseCounts()
  const cleaned = { rootRemoved: false, localDatabaseUnchanged: JSON.stringify(dbBefore) === JSON.stringify(after), databaseBefore: dbBefore, databaseAfter: after }
  await rm(root, { recursive: true, force: true })
  cleaned.rootRemoved = true
  await writeFile(path.join(evidenceDir, "plugin-probe-result.json"), `${JSON.stringify({ ...outcome, cleanup: cleaned }, null, 2)}\n`, { mode: 0o600 })
  await writeFile(path.join(evidenceDir, "plugin-probe-cleanup.json"), `${JSON.stringify(cleaned, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`${JSON.stringify({ ...outcome, cleanup: cleaned }, null, 2)}\n`)
}
