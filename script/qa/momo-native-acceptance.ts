#!/usr/bin/env bun
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync, realpathSync } from "node:fs"
import { spawn, execFileSync } from "node:child_process"
import { createServer as createNetServer } from "node:net"
import { createServer as createHttpServer, type ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"
import { run as runNativeCLI } from "../../packages/omo-opencode/src/cli/native-run/runner"

type JsonRecord = Record<string, unknown>
type JevRequest = { model?: string; state?: unknown; questions?: { candidate?: { criteria?: Record<string, string> }; lane?: { criteria?: Record<string, string> } } }
type JevChoice = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }

const evidencePath = process.env.MOMO_NATIVE_EVIDENCE_DIR ?? path.join(process.cwd(), ".omo/evidence/20261011-native-acceptance")
const selfTest = process.argv.includes("--self-test")

function statePrompt(request: JevRequest): string {
  let state = request.state
  if (typeof state === "string") {
    const serialized = state
    try { state = JSON.parse(serialized) as unknown } catch { return serialized }
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

function answerCall(conversation: string): string | undefined {
  const match = conversation.match(/Task ID: ([A-Za-z0-9_-]+)\. Question ID: ([A-Za-z0-9_-]+)/)
  if (match === null) return undefined
  const taskID = JSON.stringify(match[1])
  const questionID = JSON.stringify(match[2])
  return `await tools.momo_task({action:"answer",taskID:${taskID},questionID:${questionID},answer:"approved"}); return await tools.momo_task({action:"wait",taskID:${taskID},timeoutMs:60000})`
}

function exampleFromSchema(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
  const schema = value as { const?: unknown; enum?: unknown[]; type?: string; properties?: Record<string, unknown>; required?: string[]; items?: unknown; anyOf?: unknown[]; oneOf?: unknown[] }
  if (schema.const !== undefined) return schema.const
  if (schema.enum?.length) return schema.enum[0]
  const variants = schema.anyOf ?? schema.oneOf
  if (variants?.length) return exampleFromSchema(variants[0])
  if (schema.type === "array") return [exampleFromSchema(schema.items)]
  if (schema.type === "object" || schema.properties !== undefined) {
    const keys = schema.required ?? Object.keys(schema.properties ?? {})
    return Object.fromEntries(keys.filter((key) => schema.properties?.[key] !== undefined).map((key) => [key, exampleFromSchema(schema.properties?.[key])]))
  }
  if (schema.type === "boolean") return true
  if (schema.type === "integer" || schema.type === "number") return 1
  return "Acceptance question"
}

function candidateChoice(request: JevRequest, preferredRole?: string): string | undefined {
  const criteria = request.questions?.candidate?.criteria ?? {}
  const prompt = statePrompt(request)
  const keys = Object.keys(criteria)
  const role = preferredRole ?? (prompt.includes("MOMO_NATIVE_ACCEPTANCE_DEPARTMENT") || prompt.includes("MOMO_NATIVE_ACCEPTANCE_QUESTION_ROOT") || prompt === "MOMO_DEPT_WORK" || prompt === "MOMO_QUESTION_DEPT" ? "planner" : keys.some((key) => key.startsWith("worker|")) ? "worker" : keys[0]?.split("|")[0])
  return keys.find((key) => key.startsWith(`${role}|`))
}

function jevResponse(request: JevRequest, preferredRole?: string): { answers: Record<string, JevChoice>; usage: { input_tokens: number; output_tokens: number } } {
  const prompt = statePrompt(request)
  const availableRole = Object.keys(request.questions?.candidate?.criteria ?? {})[0]?.split("|")[0]
  const role = preferredRole ?? (prompt.includes("MOMO_NATIVE_ACCEPTANCE_DEPARTMENT") || prompt.includes("MOMO_NATIVE_ACCEPTANCE_QUESTION_ROOT") || prompt === "MOMO_DEPT_WORK" || prompt === "MOMO_QUESTION_DEPT" ? "planner" : Object.keys(request.questions?.candidate?.criteria ?? {}).some((key) => key.startsWith("worker|")) ? "worker" : availableRole)
  if (role === undefined) throw new Error("fixture has no model candidates")
  const candidate = candidateChoice(request, role)
  if (candidate === undefined) throw new Error(`fixture has no ${role} candidate`)
  const laneChoice = prompt.includes("MOMO_NATIVE_ACCEPTANCE_DEPARTMENT") || prompt.includes("MOMO_NATIVE_ACCEPTANCE_QUESTION_ROOT") || prompt === "MOMO_DEPT_WORK" || prompt === "MOMO_QUESTION_DEPT" ? "department" : "direct"
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
const pluginDir = path.join(root, "qa-plugins", "momo-native-qa")
const opencodeBinary = process.env.MOMO_NATIVE_OPENCODE_BIN ?? "/opt/homebrew/Cellar/opencode-v2/2.0.24/bin/opencode"
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
let childQuestionCalls = 0
let parentQuestionAnswers = 0
const fixtureDecisions: JsonRecord[] = []
let serviceDatabasePaths: string[] = []
const verifiedCases: string[] = []

function isolatedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:API[_-]?KEY|_KEY$|_TOKEN$|_SECRET$|PASSWORD)/i.test(key)))
  delete env.OPENCODE_DB
  delete env.OPENCODE_CONFIG
  return { ...env, OPENCODE_TEST_HOME: qaHome, OPENCODE_CONFIG_DIR: configDir, XDG_DATA_HOME: xdg.data, XDG_CONFIG_HOME: xdg.config, XDG_STATE_HOME: xdg.state, XDG_CACHE_HOME: xdg.cache, OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1", NO_COLOR: "1", ...extra }
}

function readRealDatabase(): JsonRecord | undefined {
  const realHome = process.env.HOME
  if (!realHome) return undefined
  const db = [path.join(realHome, "Library/Application Support/opencode/opencode.db"), path.join(realHome, ".local/share/opencode/opencode.db")].find(existsSync)
  if (!db) throw new Error("Real OpenCode DB is not discoverable for read-only before/after safety verification")
  const rows = execFileSync("sqlite3", ["-readonly", db, "select 'session',count(*) from session union all select 'session_message',count(*) from session_message;"], { encoding: "utf8" }).trim().split("\n")
  return { path: db, counts: Object.fromEntries(rows.map((row) => row.split("|"))) }
}

function ownedServiceDatabasePaths(pid: number): string[] {
  const groupText = execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], { encoding: "utf8" }).trim()
  const groupID = Number(groupText)
  if (!Number.isInteger(groupID) || groupID <= 0) throw new Error("Could not identify the isolated OpenCode service process group")
  const processRows = execFileSync("ps", ["-Ao", "pid=,pgid="], { encoding: "utf8" })
  const pids = processRows.split("\n").flatMap((row) => {
    const [candidatePID, candidateGroup] = row.trim().split(/\s+/).map(Number)
    return candidateGroup === groupID && Number.isInteger(candidatePID) ? [candidatePID] : []
  })
  const databasePaths = new Set<string>()
  for (const candidatePID of pids) {
    const output = execFileSync("lsof", ["-Fn", "-p", String(candidatePID)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
    for (const line of output.split("\n")) {
      if (!line.startsWith("n") || !/\.db(?:-(?:wal|shm))?$/.test(line.slice(1))) continue
      databasePaths.add(path.resolve(line.slice(1)))
    }
  }
  return [...databasePaths].sort()
}

function sendJson(response: ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json" })
  response.end(JSON.stringify(value))
}

async function readJson(request: AsyncIterable<unknown>): Promise<unknown> {
  let body = ""
  for await (const chunk of request) body += String(chunk)
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
  const body = bodyText as { model?: string; stream?: boolean; messages?: Array<{ role?: string; content?: unknown }>; tools?: Array<{ function?: { name?: string; parameters?: unknown } }> }
    const last = body.messages?.at(-1)
    const conversationText = JSON.stringify(body.messages ?? [])
    const latestUserPrompt = JSON.stringify(body.messages?.filter((message) => message.role === "user").at(-1)?.content ?? "")
    const parallelWorker = /MOMO_(?:PARALLEL|SHARED_PARENT)_WORK_\d+/.test(latestUserPrompt)
    if (parallelWorker) {
      activeParallelWorkers += 1
      maxParallelWorkers = Math.max(maxParallelWorkers, activeParallelWorkers)
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
    const text = conversationText.includes("MOMO_SHARED_PARENT_WORK_") && last?.role === "tool" ? "MOMO_SHARED_PARENT_AGGREGATED_ALL_FIVE" : conversationText.includes("MOMO_DEPT_WORKER_RESULT") ? "MOMO_DEPARTMENT_RESULT_AGGREGATED" : (conversationText.includes("MOMO_QUESTION_DEPT") || conversationText.includes("A child task is waiting for a decision.")) && (last?.role === "tool" || conversationText.includes("MOMO_TASK_ACCEPTANCE_COMPLETED")) ? "MOMO_QUESTION_DEPARTMENT_AGGREGATED" : last?.role === "tool" ? "MOMO_TASK_ACCEPTANCE_COMPLETED" : conversationText.includes("MOMO_DEPT_CHILD") ? "MOMO_DEPT_WORKER_RESULT" : "MOMO_NATIVE_ACCEPTANCE_READY"
    await appendFile(modelLog, `${JSON.stringify({ ...body, fixtureResponseText: text, fixtureLastRole: last?.role })}\n`, { mode: 0o600 })
    const promptText = latestUserPrompt
    const canUseCodeMode = body.tools?.some((tool) => tool.function?.name === "execute") === true
    const lastUserIndex = body.messages?.map((message) => message.role).lastIndexOf("user") ?? -1
    const hasToolReply = body.messages?.slice(lastUserIndex + 1).some((message) => message.role === "tool") === true
    const hasAnyToolReply = body.messages?.some((message) => message.role === "tool") === true
    const isDepartmentRoot = promptText.includes("MOMO_NATIVE_ACCEPTANCE_DEPARTMENT")
    const isDepartmentManager = promptText.includes("MOMO_DEPT_WORK") && !hasAnyToolReply
    const isParallelRoot = /MOMO_NATIVE_ACCEPTANCE_PARALLEL_\d+/.test(promptText)
    const isSharedParallelRoot = promptText.includes("MOMO_NATIVE_ACCEPTANCE_SHARED_PARALLEL")
    const isConsultRoot = /MOMO_NATIVE_ACCEPTANCE_CONSULT_[a-z-]+/.test(promptText)
    const isPermissionRoot = promptText.includes("MOMO_NATIVE_ACCEPTANCE_PERMISSION")
    const isManualCreate = !hasToolReply && promptText.includes("MOMO_NATIVE_ACCEPTANCE_SELECT_CREATE") && canUseCodeMode
    const isCLIRoot = promptText.includes("MOMO_NATIVE_ACCEPTANCE_CLI_ASYNC")
    const isQuestionRoot = promptText.includes("MOMO_NATIVE_ACCEPTANCE_QUESTION_ROOT")
    const isQuestionDepartment = promptText.includes("MOMO_QUESTION_DEPT")
    const isEscalationRoot = promptText.includes("MOMO_NATIVE_ACCEPTANCE_ESCALATION_ROOT")
    const isQuestionChild = promptText.includes("MOMO_QUESTION_CHILD") || promptText.includes("MOMO_ESCALATION_CHILD")
    const questionNotification = conversationText.includes("A child task is waiting for a decision.")
    const createConsult = last?.role === "user" && !hasToolReply && isConsultRoot && canUseCodeMode
    const createTask = isManualCreate || (last?.role === "user" && !hasAnyToolReply && (promptText.includes("MOMO_NATIVE_ACCEPTANCE_CHILD") || isDepartmentRoot || isDepartmentManager || isParallelRoot || isSharedParallelRoot || isCLIRoot || isQuestionRoot || isQuestionDepartment || isEscalationRoot) && canUseCodeMode)
    if (promptText.includes("MOMO_NATIVE_ACCEPTANCE_SELECT_CREATE")) fixtureDecisions.push({ lastRole: last?.role, promptText, hasToolReply, canUseCodeMode, isManualCreate, createTask })
    const isDepartment = promptText.includes("MOMO_NATIVE_ACCEPTANCE_DEPARTMENT")
    const parallelID = promptText.match(/MOMO_NATIVE_ACCEPTANCE_PARALLEL_(\d+)/)?.[1]
    const childPrompt = isDepartment ? "MOMO_DEPT_WORK" : isDepartmentManager ? "MOMO_DEPT_CHILD" : isParallelRoot ? `MOMO_PARALLEL_WORK_${parallelID}` : isManualCreate ? "MOMO_SELECTION_WORK" : isCLIRoot ? "MOMO_CLI_ASYNC_CHILD" : isQuestionRoot ? "MOMO_QUESTION_DEPT" : isQuestionDepartment ? "MOMO_QUESTION_CHILD" : isEscalationRoot ? "MOMO_ESCALATION_CHILD" : "MOMO_NATIVE_ACCEPTANCE_CHILD_WORK"
    const sharedParallelCode = `return await Promise.all(Array.from({length:5},(_,i)=>tools.momo_task({action:"create",prompt:"MOMO_SHARED_PARENT_WORK_"+i,waitMs:60000})))`
    const manualSelectionCode = `const task=JSON.parse(await tools.momo_task({action:"create",prompt:"MOMO_SELECTION_WORK"})); const page=JSON.parse(await tools.momo_task({action:"candidates",taskID:task.id})); const candidate=page.candidates[0]; if(!candidate) throw new Error("No offered candidate"); await tools.momo_task({action:"select",taskID:task.id,decisionId:task.decisionId,role:candidate.role,providerID:candidate.model.providerID,modelID:candidate.model.id}); return await tools.momo_task({action:"wait",taskID:task.id,timeoutMs:60000})`
    const questionTool = body.tools?.find((tool) => tool.function?.name === "question")?.function
    const questionArguments = questionTool === undefined ? undefined : exampleFromSchema(questionTool.parameters)
    const questionCall = isQuestionChild && !hasAnyToolReply && last?.role === "user" && questionTool !== undefined
      ? { tool_calls: [{ index: 0, id: `call_question_${randomUUID().replaceAll("-", "")}`, type: "function", function: { name: "question", arguments: JSON.stringify(questionArguments) } }] }
      : undefined
    const questionAnswer = questionNotification && !isEscalationRoot && parentQuestionAnswers === 0 ? answerCall(conversationText) : undefined
    if (questionCall !== undefined) childQuestionCalls += 1
    if (questionAnswer !== undefined) parentQuestionAnswers += 1
    const delta = questionCall ?? (questionAnswer !== undefined && canUseCodeMode
      ? { tool_calls: [{ index: 0, id: `call_question_answer_${randomUUID().replaceAll("-", "")}`, type: "function", function: { name: "execute", arguments: JSON.stringify({ code: questionAnswer }) } }] }
      : isPermissionRoot && !hasToolReply && last?.role === "user" && canUseCodeMode
      ? { tool_calls: [{ index: 0, id: "call_native_permission_acceptance", type: "function", function: { name: "execute", arguments: JSON.stringify({ code: `return await import("node:fs").then((fs) => fs.writeFileSync(${JSON.stringify(deniedMarker)}, "bypass"))` }) } }] }
      : createConsult
      ? { tool_calls: [{ index: 0, id: "call_native_consult_acceptance", type: "function", function: { name: "execute", arguments: JSON.stringify({ code: 'return await tools.momo_consult({action:"start",prompt:"MOMO_CONSULT_WORK",waitMs:60000})' }) } }] }
      : createTask
        ? { tool_calls: [{ index: 0, id: "call_native_task_acceptance", type: "function", function: { name: "execute", arguments: JSON.stringify({ code: isManualCreate ? manualSelectionCode : isSharedParallelRoot ? sharedParallelCode : `return await tools.momo_task({action:"create",prompt:"${childPrompt}"${isCLIRoot || isQuestionRoot || isQuestionDepartment || isEscalationRoot ? "" : ",waitMs:60000"}})` }) } }] }
      : { content: text })
    if (body.stream) {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
      response.write(`data: ${JSON.stringify({ id: "momo-acceptance", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ id: "momo-acceptance", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: createTask || createConsult || isPermissionRoot || questionCall !== undefined || questionAnswer !== undefined ? "tool_calls" : "stop" }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ id: "momo-acceptance", object: "chat.completion.chunk", created: 1, model: body.model, choices: [], usage: { prompt_tokens: 29, completion_tokens: 7, total_tokens: 36 } })}\n\n`)
      response.end("data: [DONE]\n\n")
      if (parallelWorker) activeParallelWorkers -= 1
      return
    }
    const hasToolCall = createTask || createConsult || isPermissionRoot || questionCall !== undefined || questionAnswer !== undefined
    sendJson(response, { id: "momo-acceptance", object: "chat.completion", created: 1, model: body.model, choices: [{ index: 0, message: { role: "assistant", ...(hasToolCall ? { tool_calls: "tool_calls" in delta ? delta.tool_calls : undefined } : { content: text }) }, finish_reason: hasToolCall ? "tool_calls" : "stop" }], usage: { prompt_tokens: 29, completion_tokens: 7, total_tokens: 36 } })
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
  await writeFile(path.join(pluginDir, "package.json"), JSON.stringify({ name: "momo-native-qa", type: "module", exports: { ".": "./momo-native-acceptance.ts" } }), { mode: 0o600 })
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
  await mkdir(path.join(qaHome, ".omo"), { recursive: true })
  await writeFile(path.join(qaHome, ".omo", "model-pool.json"), JSON.stringify({ version: 1, allowed: [{ providerID: "momo-qa", modelID: "momo-qa-model" }], updatedAt: new Date().toISOString() }), { mode: 0o600 })
  await writeFile(path.join(root, ".omo", "omo.jsonc"), `${JSON.stringify({ "[opencode]": { manager: { jev: { provider_id: "momo-qa", base_url: `http://127.0.0.1:${jevPort}/jev/v1`, model: "jev-1.13", max_attempts: 1 }, advisor_models: [{ providerID: "momo-qa", id: "momo-qa-model" }] } } }, null, 2)}\n`, { mode: 0o600 })
  await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ "$schema": "https://opencode.ai/config.json", plugins: [`file:${pluginDir}`], model: "momo-qa/momo-qa-model", agent: "momo-orchestrator" }, null, 2)}\n`, { mode: 0o600 })
  servicePort = await freePort()
  opencode = spawn(opencodeBinary, ["serve", "--service", "--hostname", "127.0.0.1", "--port", String(servicePort)], { cwd: root, detached: true, env: isolatedEnv({ MOMO_QA_MODEL_URL: `http://127.0.0.1:${modelPort}/v1`, MOMO_QA_PERMISSION_LOG: permissionLog }), stdio: ["ignore", "pipe", "pipe"] })
  opencode.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString() })
  opencode.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString() })
  const authorization = `Basic ${Buffer.from(`opencode:${servicePassword}`).toString("base64")}`
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${servicePort}`, headers: { authorization } })
  stage = "plugin activation"
  await waitReady(client, root)
  if (opencode.pid === undefined) throw new Error("Isolated OpenCode service has no process ID")
  serviceDatabasePaths = ownedServiceDatabasePaths(opencode.pid)
  const canonicalRoot = realpathSync(root)
  if (serviceDatabasePaths.length === 0 || serviceDatabasePaths.some((databasePath) => !databasePath.startsWith(`${canonicalRoot}${path.sep}`))) {
    throw new Error(`Isolated OpenCode service database path is outside its disposable QA root: ${JSON.stringify(serviceDatabasePaths)}`)
  }
  const version = execFileSync(opencodeBinary, ["--version"], { cwd: root, env: isolatedEnv(), encoding: "utf8" }).trim()
  if (!/\bv?2\./i.test(version)) throw new Error(`Expected supported OpenCode V2 service, got ${version}`)
  const session = await client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  stage = "direct task completion"
  await client.session.prompt({ sessionID: session.id, text: "Run a native task for the acceptance request, then report its final status: MOMO_NATIVE_ACCEPTANCE_CHILD" })
  await client.session.wait({ sessionID: session.id })
  const departmentSession = await client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  stage = "department result aggregation"
  await client.session.prompt({ sessionID: departmentSession.id, text: "Coordinate an acceptance task through one department and combine its worker result: MOMO_NATIVE_ACCEPTANCE_DEPARTMENT" })
  await client.session.wait({ sessionID: departmentSession.id })
  stage = "five parallel children under one root session"
  const sharedParallelSession = await client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  await client.session.prompt({ sessionID: sharedParallelSession.id, text: "Delegate five independent acceptance tasks concurrently, then combine all five delivered results: MOMO_NATIVE_ACCEPTANCE_SHARED_PARALLEL" })
  await client.session.wait({ sessionID: sharedParallelSession.id })
  const sharedParallelTasks = await (async () => {
    const rpc = await client.rpc.call({ rpcID: "momo.native", method: "tasks", input: { rootSessionID: sharedParallelSession.id }, location: { directory: root } })
    const envelope = rpc as { output?: unknown }
    return ((envelope.output ?? rpc) as { tasks?: unknown[] }).tasks ?? []
  })()
  const sharedChildren = sharedParallelTasks.map((value) => value as { id?: string; prompt?: string; state?: string; parentSessionID?: string; delivery?: { status?: string; attempts?: number }; result?: string })
    .filter((task) => task.prompt?.startsWith("MOMO_SHARED_PARENT_WORK_"))
  const sharedContext = await client.session.context({ sessionID: sharedParallelSession.id })
  if (sharedChildren.length !== 5 || sharedChildren.some((task) => task.parentSessionID !== sharedParallelSession.id || task.state !== "succeeded" || task.delivery?.status !== "delivered" || task.delivery.attempts !== 1) || new Set(sharedChildren.map((task) => task.id)).size !== 5 || maxParallelWorkers !== 5 || !JSON.stringify(sharedContext).includes("MOMO_SHARED_PARENT_AGGREGATED_ALL_FIVE")) {
    throw new Error(`One root did not finish five unique, once-delivered parallel child tasks and aggregate their results: ${JSON.stringify({ rootSessionID: sharedParallelSession.id, children: sharedChildren, maxParallelWorkers, aggregateSeen: JSON.stringify(sharedContext).includes("MOMO_SHARED_PARENT_AGGREGATED_ALL_FIVE") })}`)
  }
  verifiedCases.push("one root completes five unique children at once and aggregates results")
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
  stage = "default async department child question and parent answer"
  const questionSession = await client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  await client.session.prompt({ sessionID: questionSession.id, text: "Create a department asynchronously and answer its worker's question through momo_task without asking the root user: MOMO_NATIVE_ACCEPTANCE_QUESTION_ROOT" })
  await client.session.wait({ sessionID: questionSession.id })
  const questionDeadline = Date.now() + 90_000
  let questionTasks: unknown[] = []
  let questionParent: { id?: string; sessionID?: string; state?: string; prompt?: string; role?: string; result?: string; childTaskIDs?: string[] } | undefined
  let questionChild: { id?: string; state?: string; prompt?: string; role?: string; question?: { id?: string }; questionDelivery?: string; answerStatus?: string; delivery?: { status?: string; attempts?: number } } | undefined
  while (Date.now() < questionDeadline) {
    questionTasks = await readTasks(questionSession.id)
    questionParent = questionTasks.map((value) => value as typeof questionParent).find((task) => task?.prompt === "MOMO_QUESTION_DEPT")
    questionChild = questionTasks.map((value) => value as typeof questionChild).find((task) => task?.prompt === "MOMO_QUESTION_CHILD")
    if (questionParent?.state === "succeeded" && questionChild?.state === "succeeded" && questionChild.delivery?.status === "delivered") break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (questionParent?.state !== "succeeded" || !questionParent.result?.includes("MOMO_QUESTION_DEPARTMENT_AGGREGATED") || questionParent.childTaskIDs?.length !== 1 || questionChild?.state !== "succeeded" || questionChild.answerStatus !== "sent" || questionChild.questionDelivery !== "sent" || questionChild.delivery?.status !== "delivered" || questionChild.delivery.attempts !== 1 || childQuestionCalls !== 1 || parentQuestionAnswers !== 1) {
    if (questionParent?.sessionID) result.questionContext = await client.session.context({ sessionID: questionParent.sessionID })
    throw new Error(`Async department question did not reach the parent model and return through momo_task answer: ${JSON.stringify({ parent: questionParent, child: questionChild, childQuestionCalls, parentQuestionAnswers, tasks: questionTasks })}`)
  }
  if (questionParent.sessionID === undefined) throw new Error("Department question manager session was not persisted")
  const openParentForms = await client.session.form.list({ sessionID: questionParent.sessionID })
  if (openParentForms.some((form) => typeof form.metadata === "object" && form.metadata !== null && "momoNativeTaskID" in form.metadata && form.metadata.momoNativeTaskID === questionChild?.id)) throw new Error("Answered child question left a forwarded parent form open")
  verifiedCases.push("async department child question reached the manager and was answered by its model through momo_task")
  stage = "unanswered child question root escalation and native field answer"
  const escalationSession = await client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  await client.session.prompt({ sessionID: escalationSession.id, text: "Launch an asynchronous worker that asks an unanswered question, then wait for the root escalation form: MOMO_NATIVE_ACCEPTANCE_ESCALATION_ROOT" })
  await client.session.wait({ sessionID: escalationSession.id })
  const escalationDeadline = Date.now() + 180_000
  let escalationTasks: unknown[] = []
  let escalationChild: { id?: string; sessionID?: string; prompt?: string; state?: string; question?: { id?: string }; questionEscalated?: boolean; answerStatus?: string; delivery?: { status?: string; attempts?: number } } | undefined
  let rootForms: Awaited<ReturnType<typeof client.session.form.list>> = []
  let escalationForm: (typeof rootForms)[number] | undefined
  while (Date.now() < escalationDeadline) {
    escalationTasks = await readTasks(escalationSession.id)
    escalationChild = escalationTasks.map((value) => value as typeof escalationChild).find((task) => task?.prompt === "MOMO_ESCALATION_CHILD")
    rootForms = await client.session.form.list({ sessionID: escalationSession.id })
    escalationForm = rootForms.find((form) => typeof form.metadata === "object" && form.metadata !== null && "momoNativeFormKind" in form.metadata && form.metadata.momoNativeFormKind === "escalation" && "momoNativeTaskID" in form.metadata && form.metadata.momoNativeTaskID === escalationChild?.id)
    if (escalationForm !== undefined && escalationChild?.questionEscalated === true) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (escalationForm === undefined || escalationChild?.sessionID === undefined || escalationChild.question?.id === undefined) throw new Error(`Timed out waiting for the real root escalation form: ${JSON.stringify({ escalationChild, rootForms })}`)
  const rootForm = await client.session.form.get({ sessionID: escalationSession.id, formID: escalationForm.id })
  const rootAnswer = Object.fromEntries(rootForm.fields.map((field) => [field.key, "approved"]))
  if (Object.keys(rootAnswer).length === 0) throw new Error("Escalation form did not expose a native answer field key")
  await client.session.form.reply({ sessionID: escalationSession.id, formID: escalationForm.id, answer: rootAnswer })
  let answeredEscalation: typeof escalationChild | undefined = undefined
  const answerDeadline = Date.now() + 60_000
  while (Date.now() < answerDeadline) {
    escalationTasks = await readTasks(escalationSession.id)
    answeredEscalation = escalationTasks.map((value) => value as typeof escalationChild).find((task) => task?.id === escalationChild?.id)
    if (answeredEscalation?.state === "succeeded" && answeredEscalation.delivery?.status === "delivered") break
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (answeredEscalation?.state !== "succeeded" || answeredEscalation.answerStatus !== "sent" || answeredEscalation.delivery?.status !== "delivered" || answeredEscalation.delivery.attempts !== 1 || parentQuestionAnswers !== 1) {
    throw new Error(`Root escalation answer did not resume and complete the same child session: ${JSON.stringify({ escalationChild: answeredEscalation, parentQuestionAnswers })}`)
  }
  const formsAfterEscalationAnswer = await client.session.form.list({ sessionID: escalationSession.id })
  if (formsAfterEscalationAnswer.some((form) => typeof form.metadata === "object" && form.metadata !== null && "momoNativeTaskID" in form.metadata && form.metadata.momoNativeTaskID === answeredEscalation?.id)) throw new Error("Answered root escalation left a forwarded question form open")
  verifiedCases.push("unanswered child question escalates to a root form and the native field-key answer resumes the same child")
  stage = "native CLI root auto-resume after asynchronous child delivery"
  const originalStdoutWrite = process.stdout.write
  const originalServerPassword = process.env.OPENCODE_SERVER_PASSWORD
  let cliOutput = ""
  process.stdout.write = ((chunk: string | Uint8Array) => {
    cliOutput += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8")
    return true
  }) as typeof process.stdout.write
  process.env.OPENCODE_SERVER_PASSWORD = servicePassword
  let cliExitCode: number
  try {
    cliExitCode = await runNativeCLI({
      message: "Launch one asynchronous task, then combine its delivered result: MOMO_NATIVE_ACCEPTANCE_CLI_ASYNC",
      attach: `http://127.0.0.1:${servicePort}`,
      directory: root,
      timestamp: false,
      json: true,
    })
  } finally {
    process.stdout.write = originalStdoutWrite
    if (originalServerPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD
    else process.env.OPENCODE_SERVER_PASSWORD = originalServerPassword
  }
  const cliResult = JSON.parse(cliOutput.trim().split("\n").at(-1) ?? "null") as { sessionId?: string; success?: boolean }
  if (cliExitCode !== 0 || !cliResult.sessionId || cliResult.success !== true) throw new Error(`Native CLI did not wait for asynchronous child aggregation: ${cliOutput}`)
  const cliTasks = await readTasks(cliResult.sessionId)
  const cliChild = cliTasks.map((task) => task as { prompt?: string; state?: string; delivery?: { status?: string } }).find((task) => task.prompt === "MOMO_CLI_ASYNC_CHILD")
  if (cliChild?.state !== "succeeded" || cliChild.delivery?.status !== "delivered") throw new Error(`Native CLI returned before its asynchronous child was durably delivered: ${JSON.stringify(cliChild)}`)
  verifiedCases.push("native CLI waits for root aggregation after async child delivery")
  stage = "manual selection without a second Jev route"
  const selectionSession = session
  await client.session.prompt({ sessionID: selectionSession.id, text: "Use momo_task to create a task with prompt MOMO_SELECTION_WORK. Leave it awaiting my selection: MOMO_NATIVE_ACCEPTANCE_SELECT_CREATE" })
  await client.session.wait({ sessionID: selectionSession.id })
  const pendingSelectionTasks = await readTasks(selectionSession.id)
  const pendingSelection = pendingSelectionTasks.map((task) => task as { id?: string; decisionId?: string; state?: string; prompt?: string; role?: string; model?: { providerID?: string; id?: string }; candidates?: Array<{ role?: string; model?: { providerID?: string; id?: string } }> }).find((task) => task.prompt === "MOMO_SELECTION_WORK")
  const offeredCandidate = pendingSelection?.candidates?.[0]
  if (!pendingSelection?.id || !pendingSelection.decisionId || !offeredCandidate?.role || !offeredCandidate.model?.providerID || !offeredCandidate.model.id) throw new Error(`Expected a persisted manual selection from an offered candidate: ${JSON.stringify(pendingSelectionTasks)}`)
  let selectedTasks = await readTasks(selectionSession.id)
  const selectionDeadline = Date.now() + 60_000
  let selectedTask = selectedTasks.find((task) => (task as { id?: string }).id === pendingSelection.id) as { state?: string; delivery?: { status?: string }; decisionId?: string } | undefined
  while (selectedTask?.state !== "succeeded" && selectedTask?.state !== "failed" && Date.now() < selectionDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    selectedTasks = await readTasks(selectionSession.id)
    selectedTask = selectedTasks.find((task) => (task as { id?: string }).id === pendingSelection.id) as typeof selectedTask
  }
  if (selectedTask?.state !== "succeeded" || selectedTask.delivery?.status !== "delivered" || selectedTask.decisionId !== pendingSelection.decisionId) throw new Error(`Manual selection did not finish the existing task: ${JSON.stringify(selectedTask)}`)
  verifiedCases.push("manual selection finishes the existing task without a second Jev route")
  const directTasks = await readTasks(session.id)
  const departmentTasks = await readTasks(departmentSession.id)
  const parallelTasks = await Promise.all(parallelSessions.map((parallelSession) => readTasks(parallelSession.id)))
  const consultationTasks = await Promise.all(consultationSessions.map((consultationSession) => readTasks(consultationSession.id)))
  const advisorTasks = await readTasks(advisorSession.id)
  const allTasks = [...directTasks, ...departmentTasks, ...sharedParallelTasks, ...parallelTasks.flat(), ...consultationTasks.flat(), ...selectedTasks, ...cliTasks]
    .filter((task) => (task as { sourceDecisionID?: string }).sourceDecisionID === undefined)
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
  verifiedCases.push("direct and department tasks complete under the same native task RPC")
  if (parallelTasks.some((items) => items.length !== 1) || parallelTasks.some((items) => (items[0] as { role?: string }).role !== "worker") || maxParallelWorkers !== 5) throw new Error(`Five parallel task slots were not used concurrently: ${JSON.stringify({ taskCounts: parallelTasks.map((items) => items.length), roles: parallelTasks.map((items) => (items[0] as { role?: string } | undefined)?.role), maxParallelWorkers })}`)
  verifiedCases.push("five independent root sessions observed five parallel model calls")
  if (consultationTasks.some((items) => items.length !== 1 || (items[0] as { kind?: string; role?: string }).kind !== "consultation" || (items[0] as { role?: string }).role !== "advisor")) throw new Error(`A non-advisor role could not complete a bounded consultation: ${JSON.stringify(consultationTasks.map((items) => items.map((task) => ({ kind: (task as { kind?: string }).kind, role: (task as { role?: string }).role }))))}`)
  verifiedCases.push("consultation from every non-advisor role")
  if (advisorTasks.length !== 0) throw new Error(`Advisor role created a nested consultation task: ${JSON.stringify(advisorTasks)}`)
  verifiedCases.push("advisor could not create a nested consultation")
  for (const candidate of allTasks) {
    const task = candidate as { state?: string; delivery?: { status?: string }; usage?: { inputTokens?: number; outputTokens?: number } }
    if (task.state !== "succeeded" || task.delivery?.status !== "delivered") throw new Error(`Native task did not finish with durable delivered result: ${JSON.stringify(task)}`)
    if (task.usage === undefined || typeof task.usage.inputTokens !== "number" || typeof task.usage.outputTokens !== "number") throw new Error(`Native task did not persist actual session usage: ${JSON.stringify(task.usage)}`)
  }
  const departmentParent = departmentTasks.map((task) => task as { id?: string; role?: string; childTaskIDs?: string[]; result?: string }).find((task) => task.role === "planner")
  if (departmentParent?.childTaskIDs?.length !== 1 || !departmentParent.result?.includes("MOMO_DEPARTMENT_RESULT_AGGREGATED")) throw new Error(`Department did not combine its worker result after resumption: ${JSON.stringify(departmentParent)}`)
  verifiedCases.push("department resumes after child and combines child result")
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
  verifiedCases.push("coordinator tool list excludes shell, write, and delegation tools")
  const setupRows = (await Bun.file(permissionLog).exists() ? await readFile(permissionLog, "utf8") : "").trim().split("\n").filter(Boolean)
  result = { status: "partial", opencodeVersion: version, pluginID, pluginEntry, serverDatabasePaths: serviceDatabasePaths, rootSessionID: session.id, directTasks, departmentRootSessionID: departmentSession.id, departmentTasks, questionRootSessionID: questionSession.id, questionManager: questionParent, questionWorker: questionChild, questionChildCalls: childQuestionCalls, parentQuestionAnswers, forwardedFormsAfterAnswer: openParentForms.length, escalationRootSessionID: escalationSession.id, escalatedChild: answeredEscalation, rootFormAnswerKeys: Object.keys(rootAnswer), forwardedFormsAfterEscalation: formsAfterEscalationAnswer.length, sharedParallelRootSessionID: sharedParallelSession.id, sharedParallelChildren: sharedChildren, sharedParallelAggregateSeen: JSON.stringify(sharedContext).includes("MOMO_SHARED_PARENT_AGGREGATED_ALL_FIVE"), sharedParallelMaxWorkers: maxParallelWorkers, verifiedCases, departmentChildCount: sharedChildren.length, cliSessionID: cliResult.sessionId, cliExitCode, cliSuccess: cliResult.success, cliChild, selectionTaskID: pendingSelection.id, selectionState: selectedTask.state, selectionCandidate: { role: offeredCandidate.role, model: offeredCandidate.model }, selectionRouteCount, selectedTasks, parallelRootSessionIDs: parallelSessions.map((item) => item.id), parallelTaskCounts: parallelTasks.map((items) => items.length), maxParallelWorkers, consultationRoles: consultationAgents, consultationsPerRole: consultationTasks.map((items) => items.length), advisorNestedConsultationTasks: advisorTasks.length, coordinatorTools: exposedCoordinatorTools, coordinatorDynamicImportMarkerCreated: await Bun.file(deniedMarker).exists(), decisionExportRecords: decisionLines.length, liveJevRequests: jevRows.length, localModelRequests: finalRequest.length, permissionEvaluations: setupRows.map((line) => JSON.parse(line) as JsonRecord), evidence: "real OpenCode V2 service, integrated plugin entry, isolated fake provider and Jev transport" }
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
  result = { ...result, verifiedCases, failure: error instanceof Error ? error.message : String(error), failedStage: stage, serviceDatabasePaths, serviceOutput: output.slice(-4000), modelTrace: modelTrace.slice(-8), fixtureDecisions }
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
  await writeFile(path.join(evidencePath, "adversarial.json"), `${JSON.stringify({ status: acceptanceStatus ? "partial_pass" : verifiedCases.length > 0 ? "partial_pass" : "failed", livePassedCases: verifiedCases, lifecycleUnitCases: ["duplicate and late V2 events", "failed delivery retries without rerunning work", "question answer retry across reconciliation", "pending root escalation retries after notification failure", "pending parent question retries after transient notification failure with stable IDs", "active tools survive silence timeout and interrupt only after the 60-minute cap", "persisted in-place wait resumes an interrupted existing session and never reruns completed work", "actual V2 running session is not duplicated during reconciliation"], pendingLiveCases: ["restart the integrated plugin during a queued wait-for-child and verify no duplicate execution", "live active tool watchdog at 60 minutes", "network-failed parent question form delivery retry without duplicate form/notification", "live cancellation of running descendants", "permission hook denial event beyond tool surface filtering"] }, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`${JSON.stringify({ ...result, cleanup }, null, 2)}\n`)
}
