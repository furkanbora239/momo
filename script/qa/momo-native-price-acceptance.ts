#!/usr/bin/env bun
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawn, execFileSync } from "node:child_process"
import { createServer as createNetServer } from "node:net"
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"

type RecordValue = Record<string, unknown>
type ModelRequest = { model?: string; stream?: boolean; messages?: Array<{ role?: string; content?: unknown }> }
type CandidateCriteria = Record<string, string>

const root = await mkdtemp(path.join(tmpdir(), "momo-native-price-proof-"))
const qaHome = path.join(root, "test-home")
const xdg = { data: path.join(root, "xdg-data"), config: path.join(root, "xdg-config"), state: path.join(root, "xdg-state"), cache: path.join(root, "xdg-cache") }
const configDir = path.join(xdg.config, "opencode")
const evidenceDir = process.env.MOMO_NATIVE_PRICE_EVIDENCE_DIR ?? path.join(process.cwd(), ".omo/evidence/20261012-native-price-proof")
const modelLog = path.join(root, "fake-model-requests.jsonl")
const jevLog = path.join(root, "jev-requests.jsonl")
const setupLog = path.join(root, "plugin-setup.jsonl")
const knowledgePath = path.join(qaHome, ".omo/native/catalog-knowledge.json")
const modelSource = "https://fixture.example/models/momo-free/pricing"
const deniedMarker = path.join(root, "no-user-config-write")
const fakeProviderID = "momo-price-qa"
const freeID = "momo-free"
const paidID = "momo-paid"
const unknownID = "momo-unknown-zero"
const fakeProviderKey = "local-fixture-only"
const pluginEntry = process.env.MOMO_NATIVE_PLUGIN_ENTRY
if (!pluginEntry || !path.isAbsolute(pluginEntry)) throw new Error("MOMO_NATIVE_PLUGIN_ENTRY must name the absolute integrated V2 plugin entry")

let service: ReturnType<typeof spawn> | undefined
let modelServer: ReturnType<typeof createHttpServer> | undefined
let jevServer: ReturnType<typeof createHttpServer> | undefined
let serviceOutput = ""
let realDbBefore: RecordValue | undefined
let outcome: RecordValue = { status: "failed" }
let servicePort = 0
let modelPort = 0
let jevPort = 0
const servicePassword = `qa-${randomUUID()}`
const opencodeBinary = process.env.MOMO_NATIVE_OPENCODE_BIN ?? "/opt/homebrew/Cellar/opencode-v2/2.0.24/bin/opencode"

function envForQa(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:API[_-]?KEY|_KEY$|_TOKEN$|_SECRET$|PASSWORD)/i.test(key)))
  delete env.OPENCODE_CONFIG
  delete env.OPENCODE_DB
  return {
    ...env,
    OPENCODE_TEST_HOME: qaHome,
    OPENCODE_CONFIG_DIR: configDir,
    XDG_DATA_HOME: xdg.data,
    XDG_CONFIG_HOME: xdg.config,
    XDG_STATE_HOME: xdg.state,
    XDG_CACHE_HOME: xdg.cache,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_MODELS_FETCH: "1",
    NO_COLOR: "1",
    ...extra,
  }
}

function readRealDatabase(): RecordValue | undefined {
  const realHome = process.env.HOME
  if (!realHome) return undefined
  const candidates = [path.join(realHome, "Library/Application Support/opencode/opencode.db"), path.join(realHome, ".local/share/opencode/opencode.db")]
  const db = candidates.find(existsSync)
  if (!db) return undefined
  const rows = execFileSync("sqlite3", ["-readonly", db, "select 'session',count(*) from session union all select 'session_message',count(*) from session_message;"], { encoding: "utf8" }).trim().split("\n")
  return { counts: Object.fromEntries(rows.map((row) => row.split("|"))) }
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createNetServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address === null || typeof address === "string") return reject(new Error("Could not allocate loopback port"))
      server.close(() => resolve(address.port))
    })
  })
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.writeHead(status, { "content-type": "application/json" })
  response.end(JSON.stringify(payload))
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  let raw = ""
  for await (const chunk of request) raw += chunk.toString()
  return raw.length ? JSON.parse(raw) as unknown : {}
}

function recordLine(pathname: string, value: unknown): Promise<void> {
  return appendFile(pathname, `${JSON.stringify(value)}\n`, { mode: 0o600 })
}

function chatPayload(request: ModelRequest, selected: { name: string; arguments: Record<string, unknown> } | undefined): RecordValue {
  const message = selected
    ? { role: "assistant", tool_calls: [{ id: "call_price_qa", type: "function", function: { name: selected.name, arguments: JSON.stringify(selected.arguments) } }] }
    : { role: "assistant", content: "MOMO_PRICE_QA_DONE" }
  return {
    id: `price-${randomUUID()}`,
    object: "chat.completion",
    created: 1,
    model: request.model ?? "momo-price-qa-model",
    choices: [{ index: 0, message, finish_reason: selected ? "tool_calls" : "stop" }],
    usage: { prompt_tokens: 17, completion_tokens: 5, total_tokens: 22 },
  }
}

function sendChat(response: ServerResponse, payload: RecordValue, stream: boolean): void {
  if (!stream) return sendJson(response, 200, payload)
  const completion = payload as { id: string; model: string; choices: Array<{ message: RecordValue; finish_reason: string }> }
  const message = completion.choices[0]!.message
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
  if (Array.isArray(message.tool_calls)) {
    const calls = message.tool_calls as Array<{ id: string; type: string; function: { name: string; arguments: string } }>
    for (const [index, call] of calls.entries()) {
      response.write(`data: ${JSON.stringify({ id: completion.id, object: "chat.completion.chunk", created: 1, model: completion.model, choices: [{ index: 0, delta: { tool_calls: [{ index, ...call }] }, finish_reason: null }] })}\n\n`)
    }
  } else {
    response.write(`data: ${JSON.stringify({ id: completion.id, object: "chat.completion.chunk", created: 1, model: completion.model, choices: [{ index: 0, delta: { content: message.content }, finish_reason: null }] })}\n\n`)
  }
  response.write(`data: ${JSON.stringify({ id: completion.id, object: "chat.completion.chunk", created: 1, model: completion.model, choices: [{ index: 0, delta: {}, finish_reason: completion.choices[0]!.finish_reason }] })}\n\n`)
  response.end("data: [DONE]\n\n")
}

function readUserText(request: ModelRequest): string {
  const messages = request.messages ?? []
  const user = [...messages].reverse().find((message) => message.role === "user")
  return typeof user?.content === "string" ? user.content : JSON.stringify(user?.content ?? "")
}

function chooseJevCandidate(criteria: CandidateCriteria): string {
  const research = Object.keys(criteria).find((key) => key.startsWith("catalog-researcher|") && key.endsWith(`/${paidID}`))
  if (research && Object.keys(criteria).every((key) => key.startsWith("catalog-researcher|"))) return research
  const options = Object.entries(criteria).flatMap(([key, raw]) => {
    let value: RecordValue
    try { value = JSON.parse(raw) as RecordValue } catch { return [] }
    const prices = value.pricesPerMillion as RecordValue | undefined
    const contextLength = value.contextLength
    if (!key.startsWith("worker|") || value.toolCall !== true || typeof contextLength !== "number" || contextLength < 32_000 ||
      !prices || typeof prices.input !== "number" || typeof prices.output !== "number" || value.priceCurrency !== "USD") return []
    return [{ key, cost: prices.input + prices.output }]
  }).sort((left, right) => left.cost - right.cost)
  const free = options.find((option) => option.key.includes(`/${freeID}`) && option.cost === 0)
  if (!free) throw new Error("no source-priced free worker candidate met the fixture context/tool requirements")
  return free.key
}

async function startFixtures(): Promise<void> {
  modelPort = await freePort()
  modelServer = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (request.method === "GET" && url.pathname.endsWith("/models")) {
      sendJson(response, 200, { data: [freeID, paidID, unknownID].map((id) => ({ id, object: "model", created: 0, owned_by: "momo-price-qa" })) })
      return
    }
    if (request.method !== "POST" || !url.pathname.endsWith("/chat/completions")) return sendJson(response, 404, { error: "unsupported local model endpoint" })
    let parsed: ModelRequest
    try { parsed = await jsonBody(request) as ModelRequest } catch (error) { return sendJson(response, 400, { error: String(error) }) }
    await recordLine(modelLog, parsed)
    const userText = readUserText(parsed)
    const lastRole = parsed.messages?.at(-1)?.role
    let toolCall: { name: string; arguments: Record<string, unknown> } | undefined
    if (lastRole === "user" && userText.includes("MOMO_PRICE_RESEARCH")) {
      toolCall = { name: "momo_catalog_enrich", arguments: { providerID: fakeProviderID, id: freeID, summary: "Fixture source-backed model profile", sources: [modelSource], price: { currency: "USD", inputPerMillion: 0, outputPerMillion: 0, source: modelSource } } }
    } else if (lastRole === "user" && userText.includes("MOMO_PRICE_ROUTE")) {
      toolCall = { name: "execute", arguments: { code: `return await tools.momo_task({action:"create",prompt:"MOMO_PRICE_WORKER_TASK",waitMs:60000})` } }
    }
    sendChat(response, chatPayload(parsed, toolCall), parsed.stream === true)
  })
  await new Promise<void>((resolve, reject) => { modelServer?.once("error", reject); modelServer?.listen(modelPort, "127.0.0.1", resolve) })

  jevPort = await freePort()
  jevServer = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (request.method !== "POST" || !url.pathname.endsWith("/systemone")) return sendJson(response, 404, { error: "unsupported local Jev endpoint" })
    const body = await jsonBody(request) as { questions?: { candidate?: { criteria?: CandidateCriteria }; lane?: { criteria?: Record<string, string> } } }
    await recordLine(jevLog, body)
    const criteria = body.questions?.candidate?.criteria ?? {}
    let key: string
    try { key = chooseJevCandidate(criteria) } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      return
    }
    sendJson(response, 200, { model: "local-jev-fixture", answers: {
      candidate: { type: "choice", choice: key, confidence: 0.99, probabilities: { [key]: 1 } },
      lane: { type: "choice", choice: "direct", confidence: 0.99, probabilities: { direct: 1 } },
    }, usage: { input_tokens: 19, output_tokens: 5 } })
  })
  await new Promise<void>((resolve, reject) => { jevServer?.once("error", reject); jevServer?.listen(jevPort, "127.0.0.1", resolve) })
}

async function waitForService(client: ReturnType<typeof OpenCode.make>, directory: string): Promise<void> {
  const deadline = Date.now() + 30_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const providers = await client.provider.list({ location: { directory } })
      const plugins = await client.plugin.list({ location: { directory } })
      if (providers.data.some((provider) => provider.id === fakeProviderID) && plugins.data.some((plugin) => plugin.id === "oh-my-openagent" && plugin.state.status === "active")) return
    } catch (error) {
      lastError = error
      try {
        const response = await fetch(`http://127.0.0.1:${servicePort}/api/provider`, { headers: { authorization: `Basic ${Buffer.from(`opencode:${servicePassword}`).toString("base64")}` } })
        const body = await response.text()
        lastError = `${String(error)}; raw API status ${response.status}; body ${body.slice(0, 200)}`
      } catch (fetchError) {
        let listener = ""
        try { listener = execFileSync("lsof", ["-nP", `-iTCP:${servicePort}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim() } catch (lsofError) { listener = `lsof unavailable: ${String(lsofError)}` }
        let processInfo = ""
        try { processInfo = execFileSync("ps", ["-o", "pid=,ppid=,pgid=,command=", "-p", String(service?.pid)], { encoding: "utf8" }).trim() } catch (psError) { processInfo = `ps unavailable: ${String(psError)}` }
        let curlInfo = ""
        try { curlInfo = execFileSync("curl", ["--max-time", "1", "-sS", "-w", " HTTP %{http_code}", "-u", `opencode:${servicePassword}`, `http://127.0.0.1:${servicePort}/api/provider`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).slice(0, 300) } catch (curlError) { curlInfo = `curl unavailable: ${String(curlError)}` }
        lastError = `${String(error)}; raw fetch ${String(fetchError)}; curl=${curlInfo}; child pid ${service?.pid ?? "unknown"}; exit ${service?.exitCode ?? "running"}; listener=${listener}; process=${processInfo}`
      }
    }
    if (service?.exitCode !== null && service?.exitCode !== undefined) throw new Error(`OpenCode service exited ${service.exitCode}: ${serviceOutput.slice(-3000)}`)
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error(`OpenCode plugin/provider did not activate: ${String(lastError)} ${serviceOutput.slice(-3000)}`)
}

async function readTasks(client: ReturnType<typeof OpenCode.make>, rootSessionID: string, directory: string): Promise<Array<RecordValue>> {
  const rpc = await client.rpc.call({ rpcID: "momo.native", method: "tasks", input: { rootSessionID }, location: { directory } })
  const envelope = rpc as { output?: unknown }
  const payload = (envelope.output ?? rpc) as { tasks?: unknown }
  if (!Array.isArray(payload.tasks)) throw new Error("momo.native/tasks returned no tasks array")
  return payload.tasks as Array<RecordValue>
}

async function main(): Promise<void> {
  realDbBefore = readRealDatabase()
  for (const dir of [qaHome, ...Object.values(xdg), configDir, path.join(xdg.data, "opencode"), path.join(root, ".opencode", "plugins"), path.join(root, ".omo")]) {
    await mkdir(dir, { recursive: true })
  }
  await mkdir(path.join(qaHome, ".omo"), { recursive: true })
  await writeFile(path.join(qaHome, ".omo", "model-pool.json"), `${JSON.stringify({ version: 1, allowed: [freeID, paidID, unknownID].map((modelID) => ({ providerID: fakeProviderID, modelID })), updatedAt: new Date().toISOString() })}\n`, { mode: 0o600 })
  await startFixtures()
  const pluginDir = path.join(root, "qa-plugins", "momo-price-qa")
  await mkdir(pluginDir, { recursive: true })
  const pluginShim = path.join(pluginDir, "index.ts")
  await writeFile(path.join(pluginDir, "package.json"), JSON.stringify({ name: "momo-price-qa", type: "module", exports: { ".": "./index.ts" } }), { mode: 0o600 })
  await writeFile(pluginShim, [
    `import momo from ${JSON.stringify(pluginEntry)}`,
    'import { appendFileSync } from "node:fs"',
    'export default { id: "oh-my-openagent", async setup(ctx) {',
    `  appendFileSync(${JSON.stringify(setupLog)}, JSON.stringify({ stage: "setup-start" }) + "\\n")`,
    '  await ctx.provider.transform((editor) => { editor.add({ info: { id: "momo-price-qa", name: "Momo local pricing fixture", activation: "enabled", package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: process.env.MOMO_PRICE_MODEL_URL, apiKey: "local-fixture-only" } }, models: [',
    '    { id: "momo-free", modelID: "momo-free", providerID: "momo-price-qa", name: "Momo free fixture", capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 }, cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }], status: "active", enabled: true, limit: { context: 64000, output: 4096 } },',
    '    { id: "momo-paid", modelID: "momo-paid", providerID: "momo-price-qa", name: "Momo paid fixture", capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 }, cost: [{ input: 0.2, output: 0.4, cache: { read: 0, write: 0 } }], status: "active", enabled: true, limit: { context: 64000, output: 4096 } },',
    '    { id: "momo-unknown-zero", modelID: "momo-unknown-zero", providerID: "momo-price-qa", name: "Momo unknown zero fixture", capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 }, cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }], status: "active", enabled: true, limit: { context: 64000, output: 4096 } },',
    '  ] }) })',
    `  appendFileSync(${JSON.stringify(setupLog)}, JSON.stringify({ stage: "provider-added" }) + "\\n")`,
    '  await ctx.provider.reload()',
    `  appendFileSync(${JSON.stringify(setupLog)}, JSON.stringify({ stage: "provider-reloaded" }) + "\\n")`,
    '  return momo.setup(ctx)',
    '}}',
  ].join("\n"), { mode: 0o600 })
  await writeFile(path.join(configDir, "service.json"), `${JSON.stringify({ password: servicePassword })}\n`, { mode: 0o600 })
  await writeFile(path.join(xdg.data, "opencode/auth.json"), `${JSON.stringify({ [fakeProviderID]: { type: "api", key: fakeProviderKey } })}\n`, { mode: 0o600 })
  await writeFile(path.join(root, ".omo/omo.jsonc"), `${JSON.stringify({ "[opencode]": { manager: { jev: { provider_id: fakeProviderID, base_url: `http://127.0.0.1:${jevPort}/jev/v1`, model: "local-jev-fixture", max_attempts: 1 } } } }, null, 2)}\n`, { mode: 0o600 })
  await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ "$schema": "https://opencode.ai/config.json", plugins: [`file:${pluginDir}`], model: `${fakeProviderID}/${paidID}`, agent: "momo-orchestrator" }, null, 2)}\n`, { mode: 0o600 })
  servicePort = await freePort()
  const version = execFileSync(opencodeBinary, ["--version"], { cwd: root, env: envForQa(), encoding: "utf8" }).trim()
  if (!version.includes("2.0.24")) throw new Error(`Expected installed OpenCode v2.0.24, got ${version}`)
  service = spawn(opencodeBinary, ["serve", "--service", "--hostname", "127.0.0.1", "--port", String(servicePort)], {
    cwd: root,
    detached: true,
    env: envForQa({ OPENCODE_SERVER_PASSWORD: servicePassword, MOMO_PRICE_MODEL_URL: `http://127.0.0.1:${modelPort}/v1` }),
    stdio: ["ignore", "pipe", "pipe"],
  })
  service.stdout.on("data", (chunk: Buffer) => { serviceOutput += chunk.toString() })
  service.stderr.on("data", (chunk: Buffer) => { serviceOutput += chunk.toString() })
  const headers = { authorization: `Basic ${Buffer.from(`opencode:${servicePassword}`).toString("base64")}` }
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${servicePort}`, headers })
  await waitForService(client, root)

  const research = await client.session.create({ location: { directory: root }, agent: "momo-catalog-researcher", model: { providerID: fakeProviderID, id: paidID } })
  await client.session.prompt({ sessionID: research.id, text: `Store published pricing evidence: MOMO_PRICE_RESEARCH ${fakeProviderID}/${freeID}` })
  await client.session.wait({ sessionID: research.id })
  const persistedProfile = JSON.parse(await readFile(knowledgePath, "utf8")) as { entries?: Record<string, RecordValue> }
  const priceProfile = persistedProfile.entries?.[`${fakeProviderID}/${freeID}`]
  if (!priceProfile || JSON.stringify(priceProfile.price) !== JSON.stringify({ currency: "USD", inputPerMillion: 0, outputPerMillion: 0, source: modelSource })) {
    throw new Error(`Actual momo_catalog_enrich did not persist the expected source-backed free claim: ${JSON.stringify(priceProfile)}`)
  }

  const rootSession = await client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: fakeProviderID, id: paidID } })
  await client.session.prompt({ sessionID: rootSession.id, text: "Choose a cheap adequate worker for this task: MOMO_PRICE_ROUTE" })
  await client.session.wait({ sessionID: rootSession.id })
  let task: RecordValue | undefined
  const taskDeadline = Date.now() + 30_000
  while (Date.now() < taskDeadline) {
    const taskRows = await readTasks(client, rootSession.id, root)
    task = taskRows.find((row) => row.prompt === "MOMO_PRICE_WORKER_TASK")
    if (task?.state === "succeeded" && (task.delivery as RecordValue | undefined)?.status === "delivered") break
    if (task?.state === "failed" || task?.state === "cancelled") break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  if (!task || task.state !== "succeeded" || task.role !== "worker" || (task.model as RecordValue | undefined)?.id !== freeID || task.delivery && (task.delivery as RecordValue).status !== "delivered") {
    throw new Error(`Native task did not dispatch and complete on the source-backed free worker candidate: ${JSON.stringify(task)}`)
  }
  const jevRows = (await readFile(jevLog, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { questions?: { candidate?: { criteria?: CandidateCriteria } } })
  const workerRequests = jevRows.filter((row) => row.questions?.candidate?.criteria?.[`worker|${fakeProviderID}/${freeID}`] !== undefined)
  if (workerRequests.length !== 1) throw new Error(`Expected exactly one worker route, observed ${workerRequests.length}`)
  const lastCriteria = workerRequests[0]?.questions?.candidate?.criteria ?? {}
  const factFor = (id: string): RecordValue => {
    const raw = lastCriteria[`worker|${fakeProviderID}/${id}`]
    if (!raw) throw new Error(`Jev request omitted worker candidate ${id}; received ${Object.keys(lastCriteria).length} candidates`)
    return JSON.parse(raw) as RecordValue
  }
  const jevFree = factFor(freeID)
  const jevPaid = factFor(paidID)
  const jevUnknown = factFor(unknownID)
  if (JSON.stringify(jevFree.pricesPerMillion) !== JSON.stringify({ input: 0, output: 0 }) || jevFree.priceCurrency !== "USD" || jevFree.priceOrigin !== modelSource) throw new Error(`Jev did not receive the cited free USD price: ${JSON.stringify(jevFree)}`)
  if (JSON.stringify(jevPaid.pricesPerMillion) !== JSON.stringify({ input: 0.2, output: 0.4 }) || jevPaid.priceCurrency !== "USD") throw new Error(`Jev did not retain the positive SDK price: ${JSON.stringify(jevPaid)}`)
  if (JSON.stringify(jevUnknown.pricesPerMillion) !== JSON.stringify({ input: "unknown", output: "unknown" }) || jevUnknown.priceCurrency !== "unknown") throw new Error(`Jev inferred free from an unproven SDK zero: ${JSON.stringify(jevUnknown)}`)
  const modelRows = (await readFile(modelLog, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as ModelRequest)
  if (!modelRows.some((row) => row.model === freeID)) throw new Error(`Fake provider never received a worker dispatch using ${freeID}`)

  outcome = {
    status: "passed",
    opencodeVersion: version,
    pluginEntry,
    priceClaimPersistedBy: "momo_catalog_enrich",
    providerModelIdentity: `${fakeProviderID}/${freeID}`,
    sourceURL: modelSource,
    jevCandidateFacts: {
      free: { pricesPerMillion: jevFree.pricesPerMillion, priceCurrency: jevFree.priceCurrency, priceOrigin: jevFree.priceOrigin },
      priced: { pricesPerMillion: jevPaid.pricesPerMillion, priceCurrency: jevPaid.priceCurrency },
      unknownZero: { pricesPerMillion: jevUnknown.pricesPerMillion, priceCurrency: jevUnknown.priceCurrency },
    },
    selectedTask: { id: task.id, role: task.role, model: task.model, state: task.state, delivery: task.delivery },
    fakeProviderRequestCount: modelRows.length,
    jevRequestCount: jevRows.length,
    temporaryRootsOnly: true,
    noProviderCredentials: true,
  }
}

try {
  await main()
} catch (error) {
  let pluginSetupLog = ""
  try { pluginSetupLog = await readFile(setupLog, "utf8") } catch (readError) { pluginSetupLog = `unavailable: ${String(readError)}` }
  outcome = { ...outcome, status: "failed", error: error instanceof Error ? error.message : String(error), serviceTail: serviceOutput.slice(-2500), pluginSetupLog }
  process.exitCode = 1
} finally {
  if (service?.pid !== undefined) {
    const signalGroup = (signal: NodeJS.Signals) => {
      try { process.kill(-service!.pid!, signal) } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
      }
    }
    const groupAlive = () => {
      try { process.kill(-service!.pid!, 0); return true } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
        throw error
      }
    }
    signalGroup("SIGTERM")
    const termDeadline = Date.now() + 5_000
    while (groupAlive() && Date.now() < termDeadline) await new Promise((resolve) => setTimeout(resolve, 100))
    if (groupAlive()) signalGroup("SIGKILL")
    const killDeadline = Date.now() + 3_000
    while (groupAlive() && Date.now() < killDeadline) await new Promise((resolve) => setTimeout(resolve, 100))
    if (groupAlive()) outcome = { ...outcome, cleanupError: "OpenCode QA process group did not exit after SIGKILL" }
  }
  for (const server of [modelServer, jevServer]) if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  const realDbAfter = readRealDatabase()
  const dbUnchanged = JSON.stringify(realDbBefore) === JSON.stringify(realDbAfter)
  outcome = { ...outcome, realUserDatabaseUnchanged: dbUnchanged, realDatabaseBefore: realDbBefore, realDatabaseAfter: realDbAfter, pluginEntry }
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(path.join(evidenceDir, "source-backed-price-proof.json"), `${JSON.stringify(outcome, null, 2)}\n`, { mode: 0o600 })
  if (!dbUnchanged) process.exitCode = 1
  await rm(root, { recursive: true, force: true })
  process.stdout.write(`${JSON.stringify({ evidence: path.join(evidenceDir, "source-backed-price-proof.json"), ...outcome })}\n`)
}
