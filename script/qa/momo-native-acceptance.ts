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

type JsonRecord = Record<string, unknown>
type JevRequest = { model?: string; state?: unknown; questions?: { candidate?: { criteria?: Record<string, string> }; lane?: { criteria?: Record<string, string> } } }
type JevChoice = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }

const evidencePath = path.join(process.cwd(), ".omo/evidence/20261011-native-acceptance")
const selfTest = process.argv.includes("--self-test")

function statePrompt(request: JevRequest): string {
  let state = request.state
  if (typeof state === "string") {
    try { state = JSON.parse(state) as unknown } catch { return state }
  }
  if (typeof state !== "object" || state === null || !("input" in state)) return ""
  const input = (state as { input?: { prompt?: unknown } }).input
  return typeof input?.prompt === "string" ? input.prompt : ""
}

function stateDecision(request: JevRequest): string | undefined {
  let state = request.state
  if (typeof state === "string") {
    try { state = JSON.parse(state) as unknown } catch { return undefined }
  }
  if (typeof state !== "object" || state === null || !("decisionId" in state)) return undefined
  const decisionID = (state as { decisionId?: unknown }).decisionId
  return typeof decisionID === "string" ? decisionID : undefined
}

function candidateChoice(request: JevRequest, preferredRole?: string): string | undefined {
  const criteria = request.questions?.candidate?.criteria ?? {}
  const prompt = statePrompt(request)
  const keys = Object.keys(criteria)
  const role = preferredRole ?? (prompt.includes("MOMO_NATIVE_ACCEPTANCE_DEPARTMENT") || prompt === "MOMO_DEPT_WORK" ? "planner" : keys.some((key) => key.startsWith("worker|")) ? "worker" : keys[0]?.split("|")[0])
  return keys.find((key) => key.startsWith(`${role}|`))
}

function jevResponse(request: JevRequest, preferredRole?: string): { answers: Record<string, JevChoice>; usage: { input_tokens: number; output_tokens: number } } {
  const prompt = statePrompt(request)
  const availableRole = Object.keys(request.questions?.candidate?.criteria ?? {})[0]?.split("|")[0]
  const role = preferredRole ?? (prompt.includes("MOMO_NATIVE_ACCEPTANCE_DEPARTMENT") || prompt === "MOMO_DEPT_WORK" ? "planner" : Object.keys(request.questions?.candidate?.criteria ?? {}).some((key) => key.startsWith("worker|")) ? "worker" : availableRole)
  if (role === undefined) throw new Error("fixture has no model candidates")
  const candidate = candidateChoice(request, role)
  if (candidate === undefined) throw new Error(`fixture has no ${role} candidate`)
  const laneChoice = prompt.includes("MOMO_NATIVE_ACCEPTANCE_DEPARTMENT") || prompt === "MOMO_DEPT_WORK" ? "department" : "direct"
  const confidence = prompt === "MOMO_SELECTION_WORK" ? 0.2 : 0.99
  const candidateKeys = Object.keys(request.questions?.candidate?.criteria ?? {})
  const candidateProbabilities = confidence < 0.5
    ? Object.fromEntries(candidateKeys.map((key) => [key, 1 / candidateKeys.length]))
    : { [candidate]: 1 }
  return {
    answers: {
      candidate: { type: "choice", choice: candidate, confidence, probabilities: candidateProbabilities },
      lane: { type: "choice", choice: laneChoice, confidence: 0.99, probabilities: { [laneChoice]: 1 } },
    },
    usage: { input_tokens: 13, output_tokens: 5 },
  }
}

function assertSelfTest(): void {
  const request: JevRequest = { state: JSON.stringify({ input: { prompt: "Simple worker task" } }), questions: { candidate: { criteria: { "worker|momo-qa/momo-qa-model": "{}", "explore|momo-qa/momo-qa-model": "{}" } }, lane: { criteria: { direct: "", department: "" } } } }
  const result = jevResponse(request)
  if (result.answers.candidate?.choice !== "worker|momo-qa/momo-qa-model") throw new Error("Jev fixture did not select a valid candidate key")
  if (result.answers.lane?.choice !== "direct" || result.usage.input_tokens !== 13) throw new Error("Jev fixture did not return lane and real usage")
  let rejected = false
  try { jevResponse({ questions: { candidate: { criteria: {} } } }) } catch (error) { rejected = error instanceof Error }
  if (!rejected) throw new Error("Jev fixture must reject an unavailable role rather than inventing a candidate")
  process.stdout.write("momo-native-acceptance fixture self-test passed\n")
}

if (selfTest) {
  assertSelfTest()
  process.exit(0)
}

const root = await mkdtemp(path.join(tmpdir(), "momo-native-acceptance-"))
const qaHome = path.join(root, "test-home")
const xdg = { data: path.join(root, "xdg-data"), config: path.join(root, "xdg-config"), state: path.join(root, "xdg-state"), cache: path.join(root, "xdg-cache") }
const configDir = path.join(xdg.config, "opencode")
const pluginDir = path.join(root, ".opencode", "plugins")
const modelLog = path.join(root, "model-requests.jsonl")
const jevLog = path.join(root, "jev-requests.jsonl")
const permissionLog = path.join(root, "permission-events.jsonl")
const deniedMarker = path.join(root, "denied-shell-ran")
const pluginID = "oh-my-openagent"
const pluginEntry = process.env.MOMO_NATIVE_PLUGIN_ENTRY
if (!pluginEntry || !path.isAbsolute(pluginEntry)) throw new Error("Set MOMO_NATIVE_PLUGIN_ENTRY to the absolute path of the integrated OpenCode V2 plugin entry")

let opencode: ReturnType<typeof spawn> | undefined
let servers: ReturnType<typeof createHttpServer>[] = []
let output = ""
let dbBefore: JsonRecord | undefined
let result: JsonRecord = { status: "failed" }
let servicePort = 0
let stage = "setup"
let activeParallelWorkers = 0
let maxParallelWorkers = 0
let manualSelectionTarget: { taskID: string; decisionId: string } | undefined
const fixtureDecisions: JsonRecord[] = []

function isolatedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:API[_-]?KEY|_KEY$|_TOKEN$|_SECRET$|PASSWORD)/i.test(key)))
  delete env.OPENCODE_DB
  delete env.OPENCODE_CONFIG
  return { ...env, OPENCODE_TEST_HOME: qaHome, OPENCODE_CONFIG_DIR: configDir, XDG_DATA_HOME: xdg.data, XDG_CONFIG_HOME: xdg.config, XDG_STATE_HOME: xdg.state, XDG_CACHE_HOME: xdg.cache, OPENCODE_DISABLE_AUTOUPDATE: "1", NO_COLOR: "1", ...extra }
}

function readRealDatabase(): JsonRecord | undefined {
  const realHome = process.env.HOME
  if (!realHome) return undefined
  const db = [path.join(realHome, "Library/Application Support/opencode/opencode.db"), path.join(realHome, ".local/share/opencode/opencode.db")].find(existsSync)
  if (!db) throw new Error("Real OpenCode DB is not discoverable for read-only before/after safety verification")
  const rows = execFileSync("sqlite3", ["-readonly", db, "select 'session',count(*) from session union all select 'session_message',count(*) from session_message;"], { encoding: "utf8" }).trim().split("\n")
  return { path: db, counts: Object.fromEntries(rows.map((row) => row.split("|"))) }
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json" })
  response.end(JSON.stringify(value))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  let body = ""
  for await (const chunk of request) body += chunk.toString()
  return body.length === 0 ? {} : JSON.parse(body) as unknown
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createNetServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (address === null || typeof address === "string") return reject(new Error("Could not reserve a local port"))
      server.close(() => resolve(address.port))
    })
  })
}

function signalOwnedGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error
  }
}

async function ownedGroupExists(pid: number): Promise<boolean> {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
    throw error
  }
}

async function waitForOwnedGroupExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!await ownedGroupExists(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return !await ownedGroupExists(pid)
}

async function startFixture(): Promise<{ modelPort: number; jevPort: number }> {
  const modelServer = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (request.method === "GET" && url.pathname.endsWith("/models")) return sendJson(response, { data: [{ id: "momo-qa-model", object: "model", created: 0, owned_by: "momo-qa" }] })
    if (request.method !== "POST") return response.writeHead(404).end()
    const bodyText = await readJson(request)
    await appendFile(modelLog, `${JSON.stringify(bodyText)}\n`, { mode: 0o600 })
    const body = bodyText as { model?: string; stream?: boolean; messages?: Array<{ role?: string; content?: unknown }>; tools?: Array<{ function?: { name?: string } }> }
    const last = body.messages?.at(-1)
    const conversationText = JSON.stringify(body.messages ?? [])
    const latestUserPrompt = JSON.stringify(body.messages?.filter((message) => message.role === "user").at(-1)?.content ?? "")
    const parallelWorker = /MOMO_PARALLEL_WORK_\d+/.test(latestUserPrompt)
    if (parallelWorker) {
      activeParallelWorkers += 1
      maxParallelWorkers = Math.max(maxParallelWorkers, activeParallelWorkers)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    const text = conversationText.includes("MOMO_DEPT_WORKER_RESULT") ? "MOMO_DEPARTMENT_RESULT_AGGREGATED" : last?.role === "tool" ? "MOMO_TASK_ACCEPTANCE_COMPLETED" : conversationText.includes("MOMO_DEPT_CHILD") ? "MOMO_DEPT_WORKER_RESULT" : "MOMO_NATIVE_ACCEPTANCE_READY"
    const promptText = latestUserPrompt
    const canUseCodeMode = body.tools?.some((tool) => tool.function?.name === "execute") === true
    const lastUserIndex = body.messages?.map((message) => message.role).lastIndexOf("user") ?? -1
    const hasToolReply = body.messages?.slice(lastUserIndex + 1).some((message) => message.role === "tool") === true
    const isDepartmentRoot = promptText.includes("MOMO_NATIVE_ACCEPTANCE_DEPARTMENT")
    const isDepartmentManager = promptText.includes("MOMO_DEPT_WORK")
    const isParallelRoot = /MOMO_NATIVE_ACCEPTANCE_PARALLEL_\d+/.test(promptText)
    const isConsultRoot = /MOMO_NATIVE_ACCEPTANCE_CONSULT_[a-z-]+/.test(promptText)
    const isPermissionRoot = promptText.includes("MOMO_NATIVE_ACCEPTANCE_PERMISSION")
    const isManualCreate = !hasToolReply && promptText.includes("MOMO_NATIVE_ACCEPTANCE_SELECT_CREATE") && canUseCodeMode
    const isManualSelect = promptText.includes("MOMO_NATIVE_ACCEPTANCE_SELECT_NOW") && canUseCodeMode && manualSelectionTarget !== undefined
    const createConsult = last?.role === "user" && !hasToolReply && isConsultRoot && canUseCodeMode
    const createTask = last?.role === "user" && !hasToolReply && (promptText.includes("MOMO_NATIVE_ACCEPTANCE_CHILD") || isDepartmentRoot || isDepartmentManager || isParallelRoot || isManualCreate) && canUseCodeMode
    if (promptText.includes("MOMO_NATIVE_ACCEPTANCE_SELECT")) fixtureDecisions.push({ lastRole: last?.role, promptText, hasToolReply, canUseCodeMode, isManualCreate, isManualSelect, createTask })
    const isDepartment = promptText.includes("MOMO_NATIVE_ACCEPTANCE_DEPARTMENT")
    const parallelID = promptText.match(/MOMO_NATIVE_ACCEPTANCE_PARALLEL_(\d+)/)?.[1]
    const childPrompt = isDepartment ? "MOMO_DEPT_WORK" : isDepartmentManager ? "MOMO_DEPT_CHILD" : isParallelRoot ? `MOMO_PARALLEL_WORK_${parallelID}` : isManualCreate ? "MOMO_SELECTION_WORK" : "MOMO_NATIVE_ACCEPTANCE_CHILD_WORK"
    const manualCode = manualSelectionTarget === undefined ? "" : `return await tools.momo_task({action:"select",taskID:${JSON.stringify(manualSelectionTarget.taskID)},decisionId:${JSON.stringify(manualSelectionTarget.decisionId)},role:"worker",providerID:"momo-qa",modelID:"momo-qa-model"})`
    const delta = isManualSelect
      ? { tool_calls: [{ index: 0, id: "call_native_manual_selection", type: "function", function: { name: "execute", arguments: JSON.stringify({ code: manualCode }) } }] }
      : isPermissionRoot && !hasToolReply && last?.role === "user" && canUseCodeMode
      ? { tool_calls: [{ index: 0, id: "call_native_permission_acceptance", type: "function", function: { name: "execute", arguments: JSON.stringify({ code: `return await import("node:fs").then((fs) => fs.writeFileSync(${JSON.stringify(deniedMarker)}, "bypass"))` }) } }] }
      : createConsult
      ? { tool_calls: [{ index: 0, id: "call_native_consult_acceptance", type: "function", function: { name: "execute", arguments: JSON.stringify({ code: 'return await tools.momo_consult({action:"start",prompt:"MOMO_CONSULT_WORK",waitMs:60000})' }) } }] }
      : createTask
        ? { tool_calls: [{ index: 0, id: "call_native_task_acceptance", type: "function", function: { name: "execute", arguments: JSON.stringify({ code: `return await tools.momo_task({action:"create",prompt:"${childPrompt}"${isManualCreate ? "" : ",waitMs:60000"}})` }) } }] }
      : { content: text }
    if (body.stream) {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
      response.write(`data: ${JSON.stringify({ id: "momo-acceptance", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ id: "momo-acceptance", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: createTask || createConsult || isPermissionRoot || isManualSelect ? "tool_calls" : "stop" }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ id: "momo-acceptance", object: "chat.completion.chunk", created: 1, model: body.model, choices: [], usage: { prompt_tokens: 29, completion_tokens: 7, total_tokens: 36 } })}\n\n`)
      response.end("data: [DONE]\n\n")
      if (parallelWorker) activeParallelWorkers -= 1
      return
    }
    sendJson(response, { id: "momo-acceptance", object: "chat.completion", created: 1, model: body.model, choices: [{ index: 0, message: { role: "assistant", ...(createTask || createConsult || isPermissionRoot || isManualSelect ? { tool_calls: delta.tool_calls } : { content: text }) }, finish_reason: createTask || createConsult || isPermissionRoot || isManualSelect ? "tool_calls" : "stop" }], usage: { prompt_tokens: 29, completion_tokens: 7, total_tokens: 36 } })
    if (parallelWorker) activeParallelWorkers -= 1
  })
  const jevServer = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (request.method !== "POST" || !url.pathname.endsWith("/systemone")) return response.writeHead(404).end()
    const body = await readJson(request) as JevRequest
    await appendFile(jevLog, `${JSON.stringify(body)}\n`, { mode: 0o600 })
    try { sendJson(response, jevResponse(body)) } catch (error) { response.writeHead(422, { "content-type": "application/json" }).end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })) }
  })
  servers = [modelServer, jevServer]
  const listen = async (server: ReturnType<typeof createHttpServer>): Promise<number> => await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => { const address = server.address(); if (address === null || typeof address === "string") return reject(new Error("Fixture server failed to bind")); resolve(address.port) })
  })
  const [modelPort, jevPort] = await Promise.all(servers.map(listen))
  return { modelPort, jevPort }
}

async function waitReady(client: ReturnType<typeof OpenCode.make>, directory: string): Promise<void> {
  const deadline = Date.now() + 20_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await client.server.info()
      const providers = await client.provider.list({ location: { directory } })
      const plugins = await client.plugin.list({ location: { directory } })
      if (providers.data.some((item) => item.id === "momo-qa") && plugins.data.some((item) => item.id === pluginID && item.state.status === "active")) return
    } catch (error) {
      lastError = error
      if (opencode?.exitCode !== null && opencode?.exitCode !== undefined) throw new Error(`OpenCode service exited ${opencode.exitCode} before becoming ready: ${output}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`Integrated V2 plugin did not become active at 127.0.0.1:${servicePort}: ${String(lastError)}\n${output.slice(-4000)}`)
}

async function main(): Promise<void> {
  dbBefore = readRealDatabase()
  await mkdir(configDir, { recursive: true })
  for (const dir of [qaHome, ...Object.values(xdg)]) await mkdir(dir, { recursive: true })
  const { modelPort, jevPort } = await startFixture()
  await mkdir(pluginDir, { recursive: true })
  const pluginShim = path.join(pluginDir, "momo-native-acceptance.ts")
  await writeFile(pluginShim, [
    'import { appendFileSync } from "node:fs"',
    `import momo from ${JSON.stringify(pluginEntry)}`,
    'export default { id: "oh-my-openagent", async setup(ctx) {',
    '  await ctx.provider.transform((editor) => { editor.add({ info: { id: "momo-qa", name: "Momo isolated QA", activation: "enabled", package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: process.env.MOMO_QA_MODEL_URL, apiKey: "local-only" } }, models: [{ id: "momo-qa-model", modelID: "momo-qa-model", providerID: "momo-qa", name: "Momo QA", capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 }, cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }], status: "active", enabled: true, limit: { context: 8192, output: 2048 } }] }) })',
    '  await ctx.provider.reload()',
    '  const cleanup = await momo.setup(ctx)',
    '  appendFileSync(process.env.MOMO_QA_PERMISSION_LOG, JSON.stringify({ type: "setup" }) + "\\n")',
    '  await ctx.permission.hook("evaluate", (event) => { if (event.action === "shell" || event.action === "bash") { event.effect = "deny"; appendFileSync(process.env.MOMO_QA_PERMISSION_LOG, JSON.stringify({ action: event.action, effect: event.effect, sessionID: event.sessionID }) + "\\n") } })',
    '  return cleanup',
    '}}',
  ].join("\n"), { mode: 0o600 })
  const servicePassword = `qa-${randomUUID()}`
  await writeFile(path.join(configDir, "service.json"), JSON.stringify({ password: servicePassword }), { mode: 0o600 })
  await mkdir(path.join(xdg.data, "opencode"), { recursive: true })
  await writeFile(path.join(xdg.data, "opencode", "auth.json"), JSON.stringify({ "momo-qa": { type: "api", key: "local-only" } }), { mode: 0o600 })
  await mkdir(path.join(root, ".omo"), { recursive: true })
  await writeFile(path.join(root, ".omo", "omo.jsonc"), `${JSON.stringify({ "[opencode]": { manager: { jev: { provider_id: "momo-qa", base_url: `http://127.0.0.1:${jevPort}/jev/v1`, model: "jev-1.13", max_attempts: 1 }, advisor_models: [{ providerID: "momo-qa", id: "momo-qa-model" }] } } }, null, 2)}\n`, { mode: 0o600 })
  await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ "$schema": "https://opencode.ai/config.json", plugin: [pluginShim], model: "momo-qa/momo-qa-model", agent: "momo-orchestrator" }, null, 2)}\n`, { mode: 0o600 })
  servicePort = await freePort()
  opencode = spawn("opencode", ["serve", "--service", "--hostname", "127.0.0.1", "--port", String(servicePort)], { cwd: root, detached: true, env: isolatedEnv({ MOMO_QA_MODEL_URL: `http://127.0.0.1:${modelPort}/v1`, MOMO_QA_PERMISSION_LOG: permissionLog }), stdio: ["ignore", "pipe", "pipe"] })
  opencode.stdout.on("data", (chunk: Buffer) => { output += chunk.toString() })
  opencode.stderr.on("data", (chunk: Buffer) => { output += chunk.toString() })
  const authorization = `Basic ${Buffer.from(`opencode:${servicePassword}`).toString("base64")}`
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${servicePort}`, headers: { authorization } })
  stage = "plugin activation"
  await waitReady(client, root)
  const version = execFileSync("opencode", ["--version"], { cwd: root, env: isolatedEnv(), encoding: "utf8" }).trim()
  if (!/\bv2\./i.test(version)) throw new Error(`Expected supported OpenCode V2 service, got ${version}`)
  const session = await client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  stage = "direct task completion"
  await client.session.prompt({ sessionID: session.id, text: "Run a native task for the acceptance request, then report its final status: MOMO_NATIVE_ACCEPTANCE_CHILD" })
  await client.session.wait({ sessionID: session.id })
  const departmentSession = await client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  stage = "department result aggregation"
  await client.session.prompt({ sessionID: departmentSession.id, text: "Coordinate an acceptance task through one department and combine its worker result: MOMO_NATIVE_ACCEPTANCE_DEPARTMENT" })
  await client.session.wait({ sessionID: departmentSession.id })
  stage = "five parallel tasks"
  const parallelSessions = await Promise.all(Array.from({ length: 5 }, () => client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })))
  await Promise.all(parallelSessions.map(async (parallelSession, index) => {
    await client.session.prompt({ sessionID: parallelSession.id, text: `Delegate the independent acceptance task and report completion: MOMO_NATIVE_ACCEPTANCE_PARALLEL_${index}` })
    await client.session.wait({ sessionID: parallelSession.id })
  }))
  stage = "consultation from all non-advisor roles"
  const consultationAgents = ["orchestrator", "planner", "executor", "reviewer", "worker", "explore", "librarian", "research", "catalog-researcher"]
  const consultationSessions = await Promise.all(consultationAgents.map((role) => client.session.create({ location: { directory: root }, agent: `momo-${role}`, model: { providerID: "momo-qa", id: "momo-qa-model" } })))
  await Promise.all(consultationSessions.map(async (consultationSession, index) => {
    await client.session.prompt({ sessionID: consultationSession.id, text: `Use one bounded advisor consultation and report the result: MOMO_NATIVE_ACCEPTANCE_CONSULT_${consultationAgents[index]}` })
    await client.session.wait({ sessionID: consultationSession.id })
  }))
  stage = "coordinator permission denial"
  const permissionSession = await client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  await client.session.prompt({ sessionID: permissionSession.id, text: "Try an unauthorized local filesystem write through the code tool: MOMO_NATIVE_ACCEPTANCE_PERMISSION" })
  await client.session.wait({ sessionID: permissionSession.id })
  if (await Bun.file(deniedMarker).exists()) throw new Error("Orchestrator bypassed the read-only code-mode guard and wrote a local marker")
  const advisorSession = await client.session.create({ location: { directory: root }, agent: "momo-advisor", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  await client.session.prompt({ sessionID: advisorSession.id, text: "Attempt a nested consultation probe: MOMO_NATIVE_ACCEPTANCE_CONSULT_advisor" })
  await client.session.wait({ sessionID: advisorSession.id })
  const readTasks = async (rootSessionID: string): Promise<unknown[]> => {
    stage = `read native task rpc for ${rootSessionID}`
    const response = await client.rpc.call({ rpcID: "momo.native", method: "tasks", input: { rootSessionID }, location: { directory: root } })
    const envelope = response as { output?: unknown }
    const payload = (envelope.output ?? response) as { tasks?: unknown[] }
    return payload?.tasks ?? []
  }
  stage = "manual selection without a second Jev route"
  const selectionSession = session
  await client.session.prompt({ sessionID: selectionSession.id, text: "Use momo_task to create a task with prompt MOMO_SELECTION_WORK. Leave it awaiting my selection: MOMO_NATIVE_ACCEPTANCE_SELECT_CREATE" })
  const pendingSelectionTasks = await readTasks(selectionSession.id)
  const pendingSelection = pendingSelectionTasks.map((task) => task as { id?: string; decisionId?: string; state?: string; prompt?: string }).find((task) => task.prompt === "MOMO_SELECTION_WORK")
  if (!pendingSelection?.id || !pendingSelection.decisionId || pendingSelection.state !== "awaiting_selection") throw new Error(`Expected a durably pending manual selection: ${JSON.stringify(pendingSelectionTasks)}`)
  manualSelectionTarget = { taskID: pendingSelection.id, decisionId: pendingSelection.decisionId }
  await client.session.prompt({ sessionID: selectionSession.id, text: "Select the worker candidate for the pending task: MOMO_NATIVE_ACCEPTANCE_SELECT_NOW" })
  await client.session.wait({ sessionID: selectionSession.id })
  const selectedTasks = await readTasks(selectionSession.id)
  const selectedTask = selectedTasks.find((task) => (task as { id?: string }).id === pendingSelection.id) as { state?: string; delivery?: { status?: string }; decisionId?: string } | undefined
  if (selectedTask?.state !== "succeeded" || selectedTask.delivery?.status !== "delivered" || selectedTask.decisionId !== pendingSelection.decisionId) throw new Error(`Manual selection did not finish the existing task: ${JSON.stringify(selectedTask)}`)
  const directTasks = await readTasks(session.id)
  const departmentTasks = await readTasks(departmentSession.id)
  const parallelTasks = await Promise.all(parallelSessions.map((parallelSession) => readTasks(parallelSession.id)))
  const consultationTasks = await Promise.all(consultationSessions.map((consultationSession) => readTasks(consultationSession.id)))
  const advisorTasks = await readTasks(advisorSession.id)
  const allTasks = [...directTasks, ...departmentTasks, ...parallelTasks.flat(), ...consultationTasks.flat(), ...selectedTasks]
  const jevRows = (await readFile(jevLog, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as JevRequest)
  const selectionRouteCount = jevRows.filter((row) => stateDecision(row) === pendingSelection.decisionId).length
  if (selectionRouteCount !== 1) throw new Error(`Manual selection rerouted Jev decision ${pendingSelection.decisionId} ${selectionRouteCount} times`)
  if (jevRows.length < 3) throw new Error(`Expected real Jev routing for direct and department child tasks, got ${jevRows.length}`)
  if (directTasks.length < 1 || departmentTasks.length !== 2) {
    const summary = (items: unknown[]) => items.map((value) => {
      const task = value as { id?: string; parentTaskID?: string; role?: string; parentRole?: string; prompt?: string; state?: string; childTaskIDs?: string[]; kind?: string }
      return { id: task.id, parentTaskID: task.parentTaskID, role: task.role, parentRole: task.parentRole, prompt: task.prompt, state: task.state, childTaskIDs: task.childTaskIDs, kind: task.kind }
    })
    throw new Error(`Expected at least one direct task and department with one child, got task counts ${directTasks.length} and ${departmentTasks.length}; direct=${JSON.stringify(summary(directTasks))}; department=${JSON.stringify(summary(departmentTasks))}; Jev=${JSON.stringify(jevRows.map((row) => ({ prompt: statePrompt(row), candidateRoles: Object.keys(row.questions?.candidate?.criteria ?? {}).map((key) => key.split("|")[0]), laneChoices: Object.keys(row.questions?.lane?.criteria ?? {}) })))}`)
  }
  if (parallelTasks.some((items) => items.length !== 1) || parallelTasks.some((items) => (items[0] as { role?: string }).role !== "worker") || maxParallelWorkers !== 5) throw new Error(`Five parallel task slots were not used concurrently: ${JSON.stringify({ taskCounts: parallelTasks.map((items) => items.length), roles: parallelTasks.map((items) => (items[0] as { role?: string } | undefined)?.role), maxParallelWorkers })}`)
  if (consultationTasks.some((items) => items.length !== 1 || (items[0] as { kind?: string; role?: string }).kind !== "consultation" || (items[0] as { role?: string }).role !== "advisor")) throw new Error(`A non-advisor role could not complete a bounded consultation: ${JSON.stringify(consultationTasks.map((items) => items.map((task) => ({ kind: (task as { kind?: string }).kind, role: (task as { role?: string }).role }))))}`)
  if (advisorTasks.length !== 0) throw new Error(`Advisor role created a nested consultation task: ${JSON.stringify(advisorTasks)}`)
  for (const candidate of allTasks) {
    const task = candidate as { state?: string; delivery?: { status?: string }; usage?: { inputTokens?: number; outputTokens?: number } }
    if (task.state !== "succeeded" || task.delivery?.status !== "delivered") throw new Error(`Native task did not finish with durable delivered result: ${JSON.stringify(task)}`)
    if (task.usage === undefined || typeof task.usage.inputTokens !== "number" || typeof task.usage.outputTokens !== "number") throw new Error(`Native task did not persist actual session usage: ${JSON.stringify(task.usage)}`)
  }
  const departmentParent = departmentTasks.map((task) => task as { id?: string; role?: string; childTaskIDs?: string[]; result?: string }).find((task) => task.role === "planner")
  if (departmentParent?.childTaskIDs?.length !== 1 || !departmentParent.result?.includes("MOMO_DEPARTMENT_RESULT_AGGREGATED")) throw new Error(`Department did not combine its worker result after resumption: ${JSON.stringify(departmentParent)}`)
  const decisionResponse = await client.rpc.call({ rpcID: "momo.native", method: "exportDecisions", input: {}, location: { directory: root } })
  stage = "collect model and Jev evidence"
  const decisionEnvelope = decisionResponse as { output?: unknown }
  const decisionPayload = (decisionEnvelope.output ?? decisionResponse) as { lines?: unknown[] }
  const decisionLines = decisionPayload.lines ?? []
  if (decisionLines.length === 0) throw new Error("Native routing decision export returned no durable records")
  const finalRequest = (await readFile(modelLog, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as JsonRecord)
  if (finalRequest.length === 0) throw new Error("OpenCode did not call the isolated local model")
  const coordinatorRequests = finalRequest.filter((request) => JSON.stringify(request.messages ?? []).includes("MOMO_NATIVE_ACCEPTANCE_PERMISSION"))
  const exposedCoordinatorTools = [...new Set(coordinatorRequests.flatMap((request) => (Array.isArray(request.tools) ? request.tools : []).flatMap((tool) => {
    if (typeof tool !== "object" || tool === null || !("function" in tool)) return []
    const func = tool.function
    return typeof func === "object" && func !== null && "name" in func && typeof func.name === "string" ? [func.name] : []
  })))]
  if (exposedCoordinatorTools.some((name) => ["shell", "bash", "edit", "write", "task", "spawn_agent"].includes(name))) throw new Error(`Coordinator received a write, shell, or delegation tool: ${JSON.stringify(exposedCoordinatorTools)}`)
  const setupRows = (await Bun.file(permissionLog).exists() ? await readFile(permissionLog, "utf8") : "").trim().split("\n").filter(Boolean)
  result = { status: "partial", opencodeVersion: version, pluginID, pluginEntry, rootSessionID: session.id, directTasks, departmentRootSessionID: departmentSession.id, departmentTasks, selectionTaskID: pendingSelection.id, selectionState: selectedTask.state, selectionRouteCount, selectedTasks, parallelRootSessionIDs: parallelSessions.map((item) => item.id), parallelTaskCounts: parallelTasks.map((items) => items.length), maxParallelWorkers, consultationRoles: consultationAgents, consultationsPerRole: consultationTasks.map((items) => items.length), advisorNestedConsultationTasks: advisorTasks.length, coordinatorTools: exposedCoordinatorTools, coordinatorDynamicImportMarkerCreated: await Bun.file(deniedMarker).exists(), decisionExportRecords: decisionLines.length, liveJevRequests: jevRows.length, localModelRequests: finalRequest.length, permissionEvaluations: setupRows.map((line) => JSON.parse(line) as JsonRecord), evidence: "real OpenCode V2 service, integrated plugin entry, isolated fake provider and Jev transport" }
}

try {
  assertSelfTest()
  await main()
  result.status = "passed"
} catch (error) {
  let modelTrace: unknown[] = []
  try {
    modelTrace = (await readFile(modelLog, "utf8")).trim().split("\n").filter(Boolean).map((line) => {
      const request = JSON.parse(line) as JsonRecord
      const messages = Array.isArray(request.messages) ? request.messages as JsonRecord[] : []
      const lastUser = messages.filter((message) => message.role === "user").at(-1)?.content
      const tools = Array.isArray(request.tools) ? request.tools as JsonRecord[] : []
      return { lastUser, toolNames: tools.flatMap((tool) => typeof tool.function === "object" && tool.function !== null && "name" in tool.function && typeof tool.function.name === "string" ? [tool.function.name] : []), stream: request.stream }
    })
  } catch (diagnosticError) {
    modelTrace = [{ diagnosticError: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError) }]
  }
  result = { ...result, failure: error instanceof Error ? error.message : String(error), failedStage: stage, serviceOutput: output.slice(-4000), modelTrace: modelTrace.slice(-8), fixtureDecisions }
  process.exitCode = 1
} finally {
  let ownedProcessGroupGone = true
  if (opencode && opencode.exitCode === null) {
    if (opencode.pid !== undefined) signalOwnedGroup(opencode.pid, "SIGTERM")
    await Promise.race([new Promise<void>((resolve) => opencode?.once("exit", () => resolve())), new Promise<void>((resolve) => setTimeout(resolve, 5000))])
  }
  if (opencode?.pid !== undefined) {
    ownedProcessGroupGone = await waitForOwnedGroupExit(opencode.pid, 3000)
    if (!ownedProcessGroupGone) {
      signalOwnedGroup(opencode.pid, "SIGKILL")
      ownedProcessGroupGone = await waitForOwnedGroupExit(opencode.pid, 3000)
    }
  }
  for (const server of servers) if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
  const dbAfter = dbBefore === undefined ? undefined : readRealDatabase()
  const cleanup = { sandboxRemoved: false, ownedProcessGroupGone, realDatabaseUnchanged: JSON.stringify(dbBefore) === JSON.stringify(dbAfter), databaseBefore: dbBefore, databaseAfter: dbAfter }
  await rm(root, { recursive: true, force: true })
  cleanup.sandboxRemoved = true
  await mkdir(evidencePath, { recursive: true })
  await writeFile(path.join(evidencePath, "summary.json"), `${JSON.stringify({ ...result, cleanup }, null, 2)}\n`, { mode: 0o600 })
  const acceptanceStatus = result.status === "passed"
  await writeFile(path.join(evidencePath, "adversarial.json"), `${JSON.stringify({ status: acceptanceStatus ? "partial_pass" : "failed", passedCases: ["five parallel child tasks", "department child result aggregation", "consultation from each non-advisor role", "manual selection completes without a second Jev route", "coordinator tool surface excludes shell and dynamic import cannot write", "usage accounting and decision export"], pendingCases: ["cancel running descendants", "busy parent questions and restart reconciliation"] }, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`${JSON.stringify({ ...result, cleanup }, null, 2)}\n`)
}
