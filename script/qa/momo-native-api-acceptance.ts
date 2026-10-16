#!/usr/bin/env bun
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync, realpathSync } from "node:fs"
import { spawn, execFileSync } from "node:child_process"
import { createServer as createNetServer } from "node:net"
import { createServer as createHttpServer, type ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID, createHash } from "node:crypto"
import { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"

type JsonRecord = Record<string, unknown>
type JevRequest = { model?: string; state?: unknown; questions?: Record<string, { criteria?: Record<string, string> }> }
type JevChoice = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> }

const evidencePath = process.env.MOMO_NATIVE_EVIDENCE_DIR ?? path.join(process.cwd(), ".omo/evidence/20261013-api-repair")
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

function candidateChoice(request: JevRequest, preferredRole?: string): string | undefined {
  const criteria = request.questions?.candidate?.criteria ?? {}
  const prompt = statePrompt(request)
  const keys = Object.keys(criteria)
  const role = preferredRole ?? (prompt.includes("MOMO_NATIVE_ACCEPTANCE_DEPARTMENT") || prompt.includes("MOMO_NATIVE_ACCEPTANCE_QUESTION_ROOT") || prompt === "MOMO_DEPT_WORK" || prompt === "MOMO_QUESTION_DEPT" ? "planner" : keys.some((key) => key.startsWith("worker|")) ? "worker" : keys[0]?.split("|")[0])
  return keys.find((key) => key.startsWith(`${role}|`))
}

function jevResponse(request: JevRequest, preferredRole?: string): { answers: Record<string, JevChoice>; usage: { input_tokens: number; output_tokens: number } } {
  if (request.questions?.role || request.questions?.group) {
    const prompt = statePrompt(request)
    const role = preferredRole ?? (prompt.includes("DEPARTMENT") || prompt === "MOMO_DEPT_WORK" ? "planner" : "worker")
    const answers = Object.fromEntries(Object.entries(request.questions).map(([name, question]) => {
      const keys = Object.keys(question.criteria ?? {})
      if (keys.length > 255) throw new Error("Too many fixture choices")
      const selected = name === "role" ? keys.includes(role) ? role : keys[0] : name === "lane" ? ["planner", "executor", "reviewer"].includes(role) ? "department" : "direct" : keys.at(-1)
      if (!selected || !keys.includes(selected)) throw new Error(`Unavailable ${name} fixture choice`)
      return [name, { type: "choice" as const, choice: selected, confidence: prompt === "MOMO_SELECTION_WORK" ? 0.2 : 0.99, probabilities: { [selected]: 1 } }]
    }))
    return { answers, usage: { input_tokens: 13, output_tokens: 5 } }
  }
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
  const staged = jevResponse({ state: JSON.stringify({ input: { prompt: "MOMO_API_FORM_WORK" } }), questions: { role: { criteria: { planner: "lead", worker: "edit" } }, lane: { criteria: { direct: "direct", department: "lead" } } } })
  if (staged.answers.role?.choice !== "worker" || staged.answers.lane?.choice !== "direct") throw new Error("Staged fixture did not select a valid worker role/lane")
  const grouped = jevResponse({ questions: { group: { criteria: { "group-0": "[]", "group-1": "[]" } } } })
  if (grouped.answers.group?.choice !== "group-1") throw new Error("Staged group fixture failed")
  process.stdout.write("momo-native-api-acceptance fixture self-test passed\n")
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
let qaClient: ReturnType<typeof OpenCode.make>
let qaRootSessionID = ""
let nativeFormProof: unknown
let stage = "setup"
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
  const rows = execFileSync("sqlite3", ["-readonly", db, "select 'session',count(*) from session union all select 'session_v2',count(*) from session_v2 union all select 'session_message',count(*) from session_message;"], { encoding: "utf8" }).trim().split("\n")
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
  return execFileSync("ps", ["-Ao", "pgid="], { encoding: "utf8" }).trim().split(/\s+/).some(value=>Number(value)===pid)
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
    if (request.method === "GET" && url.pathname.endsWith("/models")) return sendJson(response, { data: Array.from({length:53},(_,i)=>({id:i===0?"momo-qa-model":`momo-qa-${i}`,object:"model",created:0,owned_by:"momo-qa"})) })
    if (request.method !== "POST") return response.writeHead(404).end()
    const bodyText = await readJson(request)
  const body = bodyText as { model?: string; stream?: boolean; messages?: Array<{ role?: string; content?: unknown }>; tools?: Array<{ function?: { name?: string; parameters?: unknown } }> }
    const last = body.messages?.at(-1)
    const prompt = JSON.stringify(body.messages?.filter((message) => message.role === "user").at(-1)?.content ?? "")
    const isRoot = prompt.includes("MOMO_API_PROBE") && body.tools?.some(tool=>tool.function?.name==="execute") === true && !body.messages?.some((message) => message.role === "tool")
    const code = `const parse = async input => JSON.parse(await tools.momo_task(input));
const size = value => JSON.stringify(value).length;
const check = (condition, label) => { if (!condition) throw new Error(label); };
await tools.momo_task({action:"create",prompt:"MOMO_SELECTION_WORK"});
const list = await parse({action:"list"});
const task = list.tasks.find(t=>t.prompt==="MOMO_SELECTION_WORK"); check(task?.id, "lost id recovery");
const before = await parse({action:"status",taskID:task.id}); check(size(before)<8192,"status bound"); check(before.selection.candidateCount===424,"full 424 menu");
const first = await parse({action:"candidates",taskID:task.id,limit:2,role:"worker"});
const second = await parse({action:"candidates",taskID:task.id,offset:first.nextOffset,limit:2,role:"worker"});
check(first.total===53 && first.nextOffset===2 && second.candidates[0].model.id!==first.candidates[0].model.id,"paging");
const coordinators = await parse({action:"candidates",taskID:task.id,limit:1,role:"executor"});
check(coordinators.candidates[0].rolePermissions.canDelegate && !coordinators.candidates[0].rolePermissions.canEdit && !coordinators.candidates[0].rolePermissions.canShell,"coordinator metadata");
const candidate=first.candidates[0]; check(candidate.rolePermissions.canEdit && candidate.rolePermissions.canShell && !candidate.rolePermissions.canDelegate && candidate.modelFacts.toolCall,"worker role vs model");
const selected=await parse({action:"select",taskID:task.id,decisionId:before.decisionId,role:candidate.role,providerID:candidate.model.providerID,modelID:candidate.model.id}); check(size(selected)<8192,"selected bound");
let finished=await parse({action:"wait",taskID:task.id,timeoutMs:60000});
check(finished.state==="succeeded" && finished.execution.verification==="unknown", "execution distinction");
check(finished.resultTruncated && finished.resultLength>2048 && size(finished)<8192,"result preview");
let offset=0, result=""; do {const page=await parse({action:"result",taskID:task.id,offset,limit:4096}); result+=page.result; offset=page.nextOffset;}while(offset!==undefined);
check(result=== "MOMO_API_WORKER_RESULT:"+"x".repeat(10000),"full result recovery");
const detail=await parse({action:"detail",taskID:task.id});check(detail.prompt==="MOMO_SELECTION_WORK","detail");
const formTask=await parse({action:"create",prompt:"MOMO_API_FORM_WORK"});
let formStatus; for(let i=0;i<30;i++){formStatus=await parse({action:"wait",taskID:formTask.id,timeoutMs:1000});if(formStatus.state==="waiting_question")break;}
check(formStatus?.state==="waiting_question","native form waiting");
const formDetail=await parse({action:"detail",taskID:formTask.id}); const field=formDetail.questionFields[0];
check(field.key==="k".repeat(140) && field.options[0].value==="v".repeat(300),"exact native identifiers");
await parse({action:"answer",taskID:formTask.id,questionID:formDetail.question.id,answer:{[field.key]:field.options[0].value}});
const formFinished=await parse({action:"wait",taskID:formTask.id,timeoutMs:60000});check(formFinished.state==="succeeded","native form completion");
const cancelledTask=await parse({action:"create",prompt:"MOMO_SELECTION_WORK"}); const cancelled=await parse({action:"cancel",taskID:cancelledTask.id}); check(size(cancelled)<8192 && cancelled.state==="cancelled","cancel bound");
const consult=JSON.parse(await tools.momo_consult({action:"start",prompt:"MOMO_API_ADVISOR",waitMs:60000}));check(consult.state==="succeeded" && !consult.rolePermissions.canEdit,"consult dto");
const consultList=JSON.parse(await tools.momo_consult({action:"list"}));check(consultList.tasks.some(t=>t.id===consult.id),"consult recovery");
return {apiProof:"MOMO_API_PROOF_PASSED",taskID:task.id,decisionId:before.decisionId,candidateCount:424,statusBytes:size(before),selectedBytes:size(selected),waitBytes:size(finished),cancelBytes:size(cancelled),resultLength:result.length,verification:finished.execution.verification};`
    if (prompt.includes("MOMO_API_FORM_WORK") && !prompt.includes("MOMO_API_PROBE") && !prompt.includes("A child task") && !body.messages?.some(message=>message.role==="tool")) {
      const rpc=await qaClient.rpc.call({rpcID:"momo.native",method:"tasks",input:{rootSessionID:qaRootSessionID},location:{directory:root}})
      const payload=(rpc as {output?:unknown}).output??rpc
      const task=(payload as {tasks:JsonRecord[]}).tasks.find(task=>task.prompt==="MOMO_API_FORM_WORK")
      if (typeof task?.sessionID !== "string") throw new Error("Form fixture task session missing")
      const form=await qaClient.session.form.create({sessionID:task.sessionID,title:"Choose exact native identifiers",fields:[{key:"k".repeat(140),type:"string",required:true,options:[{value:"v".repeat(300),label:"Continue"}]}]})
      const deadline=Date.now()+45000
      while(Date.now()<deadline){
        const detail=await qaClient.session.form.get({sessionID:task.sessionID,formID:form.id})
        if(detail.state.status!=="pending") {nativeFormProof=detail;break}
        await new Promise(resolve=>setTimeout(resolve,100))
      }
      if (!nativeFormProof || !JSON.stringify(nativeFormProof).includes('"'+"v".repeat(300)+'"')) throw new Error("Native form did not receive exact answer")
    }
    const text = prompt.includes("MOMO_SELECTION_WORK") ? "MOMO_API_WORKER_RESULT:" + "x".repeat(10000) : "MOMO_API_READY"
    const delta = isRoot ? { tool_calls: [{ index: 0, id: "call_api_probe", type: "function", function: { name: "execute", arguments: JSON.stringify({ code }) } }] } : { content: text }
    await appendFile(modelLog, `${JSON.stringify(body)}\n`, { mode: 0o600 })
    if (body.stream) {
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write(`data: ${JSON.stringify({ id: "api-probe", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ id: "api-probe", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: isRoot ? "tool_calls" : "stop" }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ id: "api-probe", object: "chat.completion.chunk", created: 1, model: body.model, choices: [], usage: { prompt_tokens: 29, completion_tokens: 7, total_tokens: 36 } })}\n\n`)
      response.end("data: [DONE]\n\n")
    } else sendJson(response, { choices: [{ message: { role: "assistant", ...delta }, finish_reason: isRoot ? "tool_calls" : "stop" }], usage: { prompt_tokens: 29, completion_tokens: 7 } })
  })
  const jevServer = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (request.method !== "POST" || !url.pathname.endsWith("/systemone")) return response.writeHead(404).end()
    const body = await readJson(request) as JevRequest
    await appendFile(jevLog, `${JSON.stringify(body)}\n`, { mode: 0o600 })
    if (statePrompt(body) === "MOMO_SELECTION_WORK") { response.writeHead(503, {"content-type":"application/json"}).end(JSON.stringify({error:"API fixture forces full caller-selection menu"})); return }
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
    '  await ctx.provider.transform((editor) => { editor.add({ info: { id: "momo-qa", name: "Momo isolated QA", activation: "enabled", package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: process.env.MOMO_QA_MODEL_URL, apiKey: "local-only" } }, models: Array.from({length:53},(_,i)=>({ id: i===0?"momo-qa-model":`momo-qa-${i}`, modelID: i===0?"momo-qa-model":`momo-qa-${i}`, providerID: "momo-qa", name: "Momo QA", capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 }, cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }], status: "active", enabled: true, limit: { context: 8192, output: 20000 } })) }) })',
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
  await writeFile(path.join(qaHome, ".omo", "model-pool.json"), JSON.stringify({ version: 1, allowed: Array.from({length:53},(_,i)=>({providerID:"momo-qa",modelID:i===0?"momo-qa-model":`momo-qa-${i}`})), updatedAt: new Date().toISOString() }), { mode: 0o600 })
  await mkdir(path.join(qaHome, ".omo/native"), { recursive: true })
  await writeFile(path.join(qaHome, ".omo/native/catalog-knowledge.json"), JSON.stringify({version:1,entries:Object.fromEntries(Array.from({length:53},(_,i)=>{const id=i===0?"momo-qa-model":`momo-qa-${i}`;return [`momo-qa/${id}`,{providerID:"momo-qa",id,sources:["https://example.com/fixture"],summary:"fixture",researchedAt:new Date().toISOString()}]}))}))
  await writeFile(path.join(root, ".omo", "omo.jsonc"), `${JSON.stringify({ "[opencode]": { manager: { jev: { provider_id: "momo-qa", base_url: `http://127.0.0.1:${jevPort}/jev/v1`, model: "jev-1.13", max_attempts: 1 }, advisor_models: [{ providerID: "momo-qa", id: "momo-qa-model" }] } } }, null, 2)}\n`, { mode: 0o600 })
  await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ "$schema": "https://opencode.ai/config.json", plugins: [`file:${pluginDir}`], model: "momo-qa/momo-qa-model", agent: "momo-orchestrator" }, null, 2)}\n`, { mode: 0o600 })
  servicePort = await freePort()
  opencode = spawn(opencodeBinary, ["serve", "--service", "--hostname", "127.0.0.1", "--port", String(servicePort)], { cwd: root, detached: true, env: isolatedEnv({ MOMO_QA_MODEL_URL: `http://127.0.0.1:${modelPort}/v1`, MOMO_QA_PERMISSION_LOG: permissionLog }), stdio: ["ignore", "pipe", "pipe"] })
  opencode.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString() })
  opencode.stderr?.on("data", (chunk: Buffer) => { output += chunk.toString() })
  const authorization = `Basic ${Buffer.from(`opencode:${servicePassword}`).toString("base64")}`
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${servicePort}`, headers: { authorization } })
  qaClient = client
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
  qaRootSessionID = session.id
  stage = "code-mode API lifecycle"
  await client.session.prompt({sessionID:session.id,text:"MOMO_API_PROBE"})
  await client.session.wait({sessionID:session.id})
  const context=await client.session.context({sessionID:session.id})
  const serialized=JSON.stringify(context)
  await mkdir(evidencePath, { recursive: true })
  await writeFile(path.join(evidencePath, "native-context.json"), JSON.stringify(context, null, 2))
  const rpc=await client.rpc.call({rpcID:"momo.native",method:"tasks",input:{rootSessionID:session.id},location:{directory:root}})
  const payload=(rpc as {output?:unknown}).output??rpc
  const tasks=(payload as {tasks:JsonRecord[]}).tasks
  const completed=tasks.find(t=>t.state==="succeeded" && t.kind==="task")
  if (!completed || !Array.isArray(completed.candidates) || completed.candidates.length!==424) throw new Error(`Raw RPC did not retain 424 historical candidates: ${JSON.stringify(tasks.map(t=>({id:t.id,state:t.state,role:t.role,prompt:t.prompt,candidateCount:Array.isArray(t.candidates)?t.candidates.length:0})))} context=${serialized.slice(-8000)}`)
  const jevRows=(await readFile(jevLog,"utf8")).trim().split("\n").filter(Boolean).map(line=>JSON.parse(line) as JevRequest)
  if (jevRows.filter(row=>stateDecision(row)===completed.decisionId).length!==1) throw new Error("Manual selection replayed Jev")
  const modelRows=(await readFile(modelLog,"utf8")).trim().split("\n").filter(Boolean).map(line=>JSON.parse(line) as JsonRecord)
  const toolReplies=modelRows.flatMap(row=>Array.isArray(row.messages)?row.messages as JsonRecord[]:[]).filter(message=>message.role==="tool" && JSON.stringify(message.content).includes("MOMO_API_PROOF_PASSED"))
  if (!toolReplies.length) throw new Error(`Proof marker absent from actual tool response: ${JSON.stringify(modelRows.flatMap(row => Array.isArray(row.messages) ? row.messages as JsonRecord[] : []).filter(message => message.role === "tool").map(message => ({ id: message.tool_call_id, content: JSON.stringify(message.content).slice(0, 6000) })))}`)
  const rawTaskBytes=Buffer.byteLength(JSON.stringify(completed,null,2))
  if (rawTaskBytes<=8192) throw new Error("Fixture did not reproduce the baseline raw-record bloat")
  verifiedCases.push("actual Code Mode create/list ID recovery", "424 candidates paged and selected without Jev replay", "authoritative role permission metadata", "bounded status/select/wait/cancel", "complete result paging and unknown acceptance", "consultation compact DTO and recovery", "raw RPC preserves historical record", "actual native long-key and long-option answer from detail")
  result={status:"passed",nativeFormProof,bundleSHA256:createHash("sha256").update(await readFile(pluginEntry!)).digest("hex"),opencodeVersion:version,verifiedCases,proof:toolReplies[0],rawTaskBytes,rawCandidateCount:completed.candidates.length,taskID:completed.id,decisionId:completed.decisionId}
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
      return { lastUser: (JSON.stringify(lastUser) ?? "").slice(0, 512), toolResults: messages.filter(message => message.role === "tool").map(message => ({ id: message.tool_call_id, content: JSON.stringify(message.content).slice(0, 6000) })), toolNames: tools.flatMap((tool) => typeof tool.function === "object" && tool.function !== null && "name" in tool.function && typeof tool.function.name === "string" ? [tool.function.name] : []), stream: request.stream }
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
  process.stdout.write(`${JSON.stringify({ ...result, cleanup }, null, 2)}\n`)
}
