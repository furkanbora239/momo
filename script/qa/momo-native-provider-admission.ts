#!/usr/bin/env bun
// MODIFIED: momo fork. Isolated native F17 admission probe.
import assert from "node:assert/strict"
import { spawn, execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { isAbsolute, join } from "node:path"

type Row = Record<string, unknown>
type Questions = Record<string, { criteria: Record<string, string> }>
const worktree = process.cwd(), evidence = join(worktree, ".omo/evidence/20261016-provider-admission")
const sourcePaths = ["native-runtime/model-admission.ts", "native-runtime/session-runtime.ts", "native-runtime/task-tools.ts", "native-catalog/adapter.ts", "native-catalog/provider-admission.ts", "native-routing/jev-adapter.ts", "native-routing/router.ts"]
function isolatedEnv(root: string): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: join(root, "home"), OPENCODE_TEST_HOME: join(root, "home"), TMPDIR: join(root, "tmp"), TMP: join(root, "tmp"), TEMP: join(root, "tmp"), XDG_DATA_HOME: join(root, "data"), XDG_CONFIG_HOME: join(root, "config"), XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"), OPENCODE_CONFIG_DIR: join(root, "config/opencode"), OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1", NO_COLOR: "1" }
}
function jevReply(questions: Questions) {
  const answers = Object.fromEntries(Object.entries(questions).map(([name, question]) => {
    const choice = name === "candidate" ? "worker|admission-worker/worker" : name === "role" ? "worker" : name === "lane" ? "direct" : undefined
    if (!choice || !Object.hasOwn(question.criteria, choice)) throw new Error("Unsupported fixture Jev question or candidate: " + name)
    return [name, { type: "choice", choice, confidence: 1, probabilities: { [choice]: 1 } }]
  }))
  assert(Object.keys(answers).length > 0)
  return { answers, usage: { input_tokens: 13, output_tokens: 5 } }
}
function pluginFixture(modelURL: string, root: string): string {
  return `import momo from ${JSON.stringify(join(worktree, "dist/index.js"))};
import {existsSync,writeFileSync} from 'node:fs';
const root=${JSON.stringify(root)},originalFetch=globalThis.fetch;let fired=false;
globalThis.fetch=async function(input,init){
 const request=new Request(input,init);let body;
 if(request.method==='POST'&&new URL(request.url).pathname.endsWith('/session')){
  try{body=await request.clone().json()}catch(error){body=undefined}
 }
 const response=await originalFetch(input,init);
 if(!fired&&response.ok&&body?.metadata?.momoNativeTask&&existsSync(root+'/arm-after-allocation')){
  fired=true;writeFileSync(root+'/home/.omo/provider-toggles.json',JSON.stringify({version:1,disabled:['admission-worker'],updatedAt:new Date().toISOString()}));
  writeFileSync(root+'/allocation-fired.json',JSON.stringify({requestURL:request.url,metadata:body.metadata.momoNativeTask,status:response.status}));
 }
 return response;
};
export default {id:'oh-my-openagent',async setup(ctx){
 await ctx.provider.transform(editor=>{for(const [id,model] of [['admission-root','root'],['admission-worker','worker'],['admission-manager',null]]){
 editor.add({info:{id,name:id,activation:'enabled',package:'aisdk:@ai-sdk/openai-compatible',settings:{baseURL:${JSON.stringify(modelURL)}+'/'+id+'/v1',apiKey:'local-only'}},models:model?[{id:model,modelID:model,providerID:id,name:model,capabilities:{tools:true,input:['text'],output:['text']},variants:[],time:{released:0},cost:[{input:1,output:1,cache:{read:0,write:0}}],status:'active',enabled:true,limit:{context:32000,output:4096}}]:[]});
 }});await ctx.provider.reload();return await momo.setup(ctx);
}};`
}
async function hashes(stage: "before" | "after") {
  return Object.fromEntries(await Promise.all([...sourcePaths.map(path => "packages/omo-opencode/src/" + path), "dist/index.js", "script/qa/momo-native-provider-admission.ts"].map(async path => {
    const content = await readFile(join(worktree, path))
    if (path !== "dist/index.js") {
      const snapshotPath = join(evidence, "source-" + stage, path)
      await mkdir(join(snapshotPath, ".."), { recursive: true }); await writeFile(snapshotPath, content)
    }
    return [path, createHash("sha256").update(content).digest("hex")]
  })))
}
async function poll<T>(read: () => Promise<T>, ready: (value: T) => boolean, stage: string, timeout = 20000): Promise<T> {
  const end = Date.now() + timeout
  while (Date.now() < end) { const value = await read(); if (ready(value)) return value; await Bun.sleep(50) }
  throw new Error("Timed out: " + stage)
}
if (process.argv.includes("--self-test")) {
  const candidate = { criteria: { "worker|admission-worker/worker": "worker" } }, lane = { criteria: { direct: "direct" } }
  assert.equal(jevReply({ candidate, lane }).answers.candidate?.choice, "worker|admission-worker/worker")
  assert.equal(jevReply({ role: { criteria: { worker: "worker" } }, lane }).answers.role?.choice, "worker")
  assert.throws(() => jevReply({ unknown: lane }), /Unsupported/)
  assert.throws(() => jevReply({ candidate: { criteria: { "worker|other/model": "other" } } }), /Unsupported/)
  const env = isolatedEnv("/isolated")
  assert(Object.keys(env).every(key => !/TOKEN|SECRET|PASSWORD|API_KEY/.test(key)))
  for (const key of ["HOME", "OPENCODE_TEST_HOME", "TMPDIR", "TMP", "TEMP", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME", "OPENCODE_CONFIG_DIR"]) assert(env[key]?.startsWith("/isolated/"))
  new Bun.Transpiler({ loader: "js" }).transformSync(pluginFixture("http://127.0.0.1:1234", "/isolated"))
  console.log("provider admission fixture self-test passed; no native process started"); process.exit(0)
}
const bin = process.env.MOMO_NATIVE_OPENCODE_BIN
assert(bin && isAbsolute(bin) && existsSync(bin), "Set MOMO_NATIVE_OPENCODE_BIN to an existing absolute native binary, not a wrapper")
const { OpenCode } = await import("../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js")
await mkdir(evidence, { recursive: true })
const realDB = join(process.env.HOME ?? "", ".local/share/opencode/opencode.db")
function counts() {
  assert(existsSync(realDB), "Real DB required for read-only isolation comparison")
  const tables = execFileSync("sqlite3", ["-readonly", realDB, "SELECT name FROM sqlite_master WHERE type='table'"], { encoding: "utf8" }).trim().split("\n")
  return Object.fromEntries(["session", "session_v2", "session_message"].map(table => [table, tables.includes(table) ? Number(execFileSync("sqlite3", ["-readonly", realDB, `SELECT count(*) FROM ${table}`], { encoding: "utf8" }).trim()) : null]))
}
const before = counts()
const root = await mkdtemp(join(tmpdir(), "momo-provider-admission-")), env = isolatedEnv(root)
const project = join(root, "project"), plugin = join(root, "plugin"), home = env.HOME!, config = env.OPENCODE_CONFIG_DIR!
const results: Row = { status: "running", uncovered: ["department aggregation provider boundary", "native forwarded form reply provider boundary", "native resume boundary"] }
const requests: Row[] = [], openedDBs = new Set<string>(), ownedGroups: number[] = [], rootIDs: string[] = []
let proc: ReturnType<typeof spawn> | undefined, output = "", mockError: string | undefined
let holdModels = false, heldModels = false, releaseModels: (() => void) | undefined
let holdWorker = false, heldWorker = false, releaseWorker: (() => void) | undefined
const toggles = (disabled: string[]) => writeFile(join(home, ".omo/provider-toggles.json"), JSON.stringify({ version: 1, disabled, updatedAt: new Date().toISOString() }))
const server = createServer(async (request, response) => {
  try {
    const path = request.url ?? "", provider = path.split("/")[1]
    if (request.method === "GET" && path.endsWith("/models")) {
      requests.push({ type: "models", provider })
      if (provider === "admission-worker" && holdModels) { holdModels = false; heldModels = true; await new Promise<void>(resolve => { releaseModels = resolve }) }
      response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ data: [{ id: provider === "admission-root" ? "root" : "worker", object: "model", created: 0, owned_by: provider }] })); return
    }
    let raw = ""; for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw) as { model?: string; questions?: Questions; messages?: Array<{ role: string; content: unknown }>; tools?: Array<{ function?: { name?: string } }> }
    if (path.startsWith("/jev/")) {
      requests.push({ type: "jev", questions: body.questions }); assert(body.questions)
      response.setHeader("content-type", "application/json"); response.end(JSON.stringify(jevReply(body.questions))); return
    }
    assert(request.method === "POST" && path.endsWith("/chat/completions"), "Unexpected mock endpoint " + path)
    const text = JSON.stringify(body.messages), worker = provider === "admission-worker"
    requests.push({ type: worker ? "worker" : "root", text })
    if (worker && holdWorker) { holdWorker = false; heldWorker = true; await new Promise<void>(resolve => { releaseWorker = resolve }) }
    const marker = text.match(/F17_(?:MANAGER_OFF|ENABLED|CATALOG_RACE|ALLOCATION_RACE|DELIVERY)/)?.[0]
    const call = !worker && marker && !body.messages?.some(message => message.role === "tool") && body.tools?.some(tool => tool.function?.name === "execute")
    const delta = call ? { tool_calls: [{ index: 0, id: "call_" + crypto.randomUUID().replaceAll("-", ""), type: "function", function: { name: "execute", arguments: JSON.stringify({ code: `return JSON.parse(await tools.momo_task({action:'create',prompt:'${marker}_CHILD'}))` }) } }] } : { content: worker ? "F17_CHILD_RESULT" : "F17_ROOT_DONE" }
    const chunk = (value: unknown, finish: unknown) => ({ id: "f17", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: value, finish_reason: finish }] })
    response.setHeader("content-type", "text/event-stream"); response.end(`data: ${JSON.stringify(chunk(delta, null))}\n\ndata: ${JSON.stringify(chunk({}, call ? "tool_calls" : "stop"))}\n\ndata: [DONE]\n\n`)
  } catch (error) { mockError = String(error); response.statusCode = 500; response.end(JSON.stringify({ error: mockError })) }
})
const count = (type: string) => requests.filter(row => row.type === type).length
async function captureDBs() {
  for (const row of execFileSync("ps", ["-Ao", "pid=,pgid="], { encoding: "utf8" }).split("\n")) {
    const [pid, group] = row.trim().split(/\s+/).map(Number); if (!ownedGroups.includes(group!)) continue
    let fds: string[]
    try { fds = await readdir(`/proc/${pid}/fd`) } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error }
    for (const fd of fds) {
      try { const path = await readlink(`/proc/${pid}/fd/${fd}`); if (/\.db(?:-(?:wal|shm))?$/.test(path)) { assert(path.startsWith(root + "/"), "Native process opened non-isolated DB: " + path); openedDBs.add(path) } }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
    }
  }
}
try {
  for (const directory of [project, plugin, config, home, join(home, ".omo"), join(project, ".omo"), env.TMPDIR!]) await mkdir(directory, { recursive: true })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const modelAddress = server.address(); assert(modelAddress && typeof modelAddress !== "string")
  const pluginSource = pluginFixture(`http://127.0.0.1:${modelAddress.port}`, root)
  await writeFile(join(plugin, "package.json"), JSON.stringify({ name: "provider-admission-qa", type: "module", exports: { ".": "./index.js" } }))
  await writeFile(join(plugin, "index.js"), pluginSource); await writeFile(join(evidence, "fixture.js"), pluginSource)
  await writeFile(join(home, ".omo/model-pool.json"), JSON.stringify({ version: 1, allowed: [{ providerID: "admission-worker", modelID: "worker" }], updatedAt: new Date().toISOString() })); await toggles([])
  await writeFile(join(project, ".omo/omo.jsonc"), JSON.stringify({ "[opencode]": { manager: { jev: { provider_id: "admission-manager", base_url: `http://127.0.0.1:${modelAddress.port}/jev/v1`, max_attempts: 1, budget: { monthly_cap_usd: 2, warn_at_usd: 1.5 } } } } }))
  await writeFile(join(config, "opencode.json"), JSON.stringify({ plugins: [`file:${plugin}`], model: "admission-root/root", agent: "momo-orchestrator" }))
  await writeFile(join(config, "service.json"), JSON.stringify({ password: "local-qa" })); results.hashesBefore = await hashes("before")
  const reserve = createServer(); await new Promise<void>(resolve => reserve.listen(0, "127.0.0.1", resolve)); const address = reserve.address(); assert(address && typeof address !== "string"); const port = address.port; await new Promise<void>(resolve => reserve.close(() => resolve()))
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${port}`, headers: { authorization: "Basic " + Buffer.from("opencode:local-qa").toString("base64") } })
  proc = spawn(bin, ["serve", "--service", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: project, env, detached: true, stdio: ["ignore", "pipe", "pipe"] }); assert(proc.pid); ownedGroups.push(proc.pid)
  proc.stdout?.on("data", chunk => { output += chunk }); proc.stderr?.on("data", chunk => { output += chunk })
  await poll(async () => { try { return (await client.plugin.list({ location: { directory: project } })).data.some(row => row.id === "oh-my-openagent" && row.state.status === "active") } catch (error) { return false } }, Boolean, "built plugin activation")
  results.version = (await client.server.info()).version; await captureDBs()
  async function tasks(rootSessionID: string): Promise<Row[]> {
    await captureDBs()
    const response = await client.rpc.call({ rpcID: "momo.native", method: "tasks", input: { rootSessionID }, location: { directory: project } })
    const value = ((response as { output?: unknown }).output ?? response) as { tasks?: unknown }; assert(Array.isArray(value.tasks)); return value.tasks as Row[]
  }
  async function launch(marker: string) {
    const session = await client.session.create({ location: { directory: project }, agent: "momo-orchestrator", model: { providerID: "admission-root", id: "root" } }); rootIDs.push(session.id)
    const pending = client.session.prompt({ sessionID: session.id, text: marker }); return { session, pending }
  }
  const snapshot = () => ({ jev: count("jev"), worker: count("worker") })
  await toggles(["admission-manager"]); const offBefore = snapshot(), off = await launch("F17_MANAGER_OFF"); await off.pending; await client.session.wait({ sessionID: off.session.id })
  assert.deepEqual(snapshot(), offBefore, "Disabled manager with credential must send zero Jev/worker HTTP"); results.managerDisabled = { before: offBefore, after: snapshot(), credentialPresent: true }
  await toggles([]); const enabledBefore = snapshot(), enabled = await launch("F17_ENABLED"); await enabled.pending
  const success = await poll(() => tasks(enabled.session.id), rows => rows.some(row => row.prompt === "F17_ENABLED_CHILD" && row.state === "succeeded" && (row.delivery as Row)?.status === "delivered"), "reenabled worker success", 40000)
  await client.session.wait({ sessionID: enabled.session.id }); assert(count("jev") > enabledBefore.jev && count("worker") > enabledBefore.worker, "Positive budget must route and execute after reenabling"); results.reenabled = { before: enabledBefore, after: snapshot(), tasks: success }
  holdModels = true; heldModels = false; const raceBefore = snapshot(), race = await launch("F17_CATALOG_RACE")
  await poll(async () => heldModels, Boolean, "worker models response held"); await toggles(["admission-worker"]); releaseModels!(); await race.pending; await client.session.wait({ sessionID: race.session.id })
  assert.deepEqual(snapshot(), raceBefore, "Catalog race must send zero extra Jev/worker HTTP"); results.catalogRace = { before: raceBefore, after: snapshot(), heldModels: true }
  await toggles([]); await writeFile(join(root, "arm-after-allocation"), "armed"); const allocationBefore = count("worker"), allocation = await launch("F17_ALLOCATION_RACE"); await allocation.pending
  await poll(async () => existsSync(join(root, "allocation-fired.json")), Boolean, "successful native allocation hook fired")
  const failed = await poll(() => tasks(allocation.session.id), rows => rows.some(row => row.prompt === "F17_ALLOCATION_RACE_CHILD" && row.state === "failed"), "allocated child guard rejects")
  assert.equal(count("worker"), allocationBefore, "Native start boundary must block worker LLM HTTP"); results.allocationRace = { hook: JSON.parse(await readFile(join(root, "allocation-fired.json"), "utf8")), workerCallsBefore: allocationBefore, workerCallsAfter: count("worker"), tasks: failed }
  await rm(join(root, "arm-after-allocation")); await toggles([]); holdWorker = true
  const delivery = await launch("F17_DELIVERY"); await poll(async () => heldWorker, Boolean, "delivery worker held"); await delivery.pending; await client.session.wait({ sessionID: delivery.session.id })
  const rootBefore = count("root"); await toggles(["admission-root"]); releaseWorker!()
  const blocked = await poll(() => tasks(delivery.session.id), rows => rows.some(row => row.prompt === "F17_DELIVERY_CHILD" && row.state === "succeeded" && (row.delivery as Row)?.status === "pending" && typeof (row.delivery as Row)?.lastError === "string"), "root delivery guard blocks")
  await Bun.sleep(350); assert.equal(count("root"), rootBefore, "Disabled root must receive zero steer generation HTTP"); await toggles([])
  const delivered = await poll(() => tasks(delivery.session.id), rows => rows.some(row => row.prompt === "F17_DELIVERY_CHILD" && (row.delivery as Row)?.status === "delivered"), "reenabled root retry", 45000)
  await client.session.wait({ sessionID: delivery.session.id }); results.rootTrace = requests.filter(row => row.type === "root").map(row => String(row.text).slice(0, 240).replace(/\s+/g, " ")); assert.equal(count("root"), rootBefore + 1, "Root retry must generate exactly once"); results.rootSteer = { blocked, delivered, rootCallsBefore: rootBefore, rootCallsAfter: count("root") }
  await captureDBs(); assert(openedDBs.size > 0, "No actual native DB descriptors observed")
  const db = [...openedDBs].find(path => path.endsWith(".db")); assert(db)
  const tables = execFileSync("sqlite3", ["-readonly", db, "SELECT name FROM sqlite_master WHERE type='table'"], { encoding: "utf8" }).split("\n"), table = tables.includes("session_v2") ? "session_v2" : "session"
  results.isolatedSessionLookup = rootIDs.map(id => { assert(/^[A-Za-z0-9_-]+$/.test(id)); const count = Number(execFileSync("sqlite3", ["-readonly", db, `SELECT count(*) FROM ${table} WHERE id='${id}'`], { encoding: "utf8" }).trim()); assert.equal(count, 1); return { id, table, count } })
  assert.equal(mockError, undefined); results.hashesAfter = await hashes("after"); assert.deepEqual(results.hashesAfter, results.hashesBefore, "Source/bundle changed during probe"); results.status = "passed"
} catch (error) { results.status = "failed"; results.error = String(error) } finally {
  releaseModels?.(); releaseWorker?.()
  try { if (proc?.pid) { process.kill(-proc.pid, "SIGTERM"); await Promise.race([new Promise(resolve => proc!.once("exit", resolve)), Bun.sleep(3000)]); if (proc.exitCode === null && proc.signalCode === null) { process.kill(-proc.pid, "SIGKILL"); await new Promise(resolve => proc!.once("exit", resolve)) } } }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") { results.cleanupError = String(error); results.status = "failed" } }
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  const after = counts(), groups = execFileSync("ps", ["-Ao", "pgid="], { encoding: "utf8" }).split("\n").map(row => Number(row.trim()))
  results.cleanup = { realDatabaseCountsBefore: before, realDatabaseCountsAfter: after, unchanged: JSON.stringify(before) === JSON.stringify(after), ownedGroups, ownedProcessGroupGone: ownedGroups.every(group => !groups.includes(group)), openedDBs: [...openedDBs] }
  if (JSON.stringify(before) !== JSON.stringify(after) || ownedGroups.some(group => groups.includes(group))) results.status = "failed"
  await writeFile(join(evidence, "service.log"), output); await writeFile(join(evidence, "requests.json"), JSON.stringify(requests, null, 2)); await rm(root, { recursive: true, force: true }); results.disposableRootRemoved = !existsSync(root)
  await writeFile(join(evidence, "result.json"), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results)); if (results.status !== "passed") process.exitCode = 1
}
