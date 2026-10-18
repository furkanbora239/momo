import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, readlink } from "node:fs/promises"
import { createHash } from "node:crypto"
import { spawn, execFileSync } from "node:child_process"
import { tmpdir } from "node:os"
import { join, isAbsolute } from "node:path"
import { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"
import { createNativeSessionRuntime } from "../../packages/omo-opencode/src/native-runtime/session-runtime"
import { createFileNativeTaskRepository } from "../../packages/omo-opencode/src/native-task/file-repository"
import { proveBuiltNativeConsumption } from "./momo-native-consumption-integration"
import { mapV2TaskEvent } from "../../packages/omo-opencode/src/native-task/v2-event-adapter"
import type { NativeTask } from "../../packages/omo-opencode/src/native-task/types"

const bin = process.env.MOMO_NATIVE_OPENCODE_BIN
if (!bin || !isAbsolute(bin)) throw new Error("Set MOMO_NATIVE_OPENCODE_BIN to the installed native binary")
const sourcePaths = ["native-runtime/session-runtime.ts", "native-task/task-controls.ts", "native-task/task-lifecycle.ts", "native-task/file-repository.ts", "native-task/v2-event-adapter.ts", "native-task/child-batch-delivery.ts", "native-task/types.ts", "native-runtime/delivery-message-id.ts"]
const integrated = process.env.MOMO_PROBE_INTEGRATED === "1"
const worktree = process.cwd(), root = await mkdtemp(join(tmpdir(), "momo-consumption-"))
const evidence = join(worktree, ".omo/evidence/20261013-consumption-repair", integrated ? "integrated" : "contract")
const project = join(root, "project"), config = join(root, "config/opencode")
const realDB = join(process.env.HOME ?? "", ".local/share/opencode/opencode.db")
const counts = () => Object.fromEntries(["session", "session_v2", "session_message"].map(table => [table, Number(execFileSync("sqlite3", ["-readonly", realDB, "SELECT count(*) FROM " + table], { encoding: "utf8" }).trim())]))
const before = counts()
const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(root, "home"), OPENCODE_TEST_HOME: join(root, "home"), OPENCODE_CONFIG_DIR: config, XDG_DATA_HOME: join(root, "data"), XDG_CONFIG_HOME: join(root, "config"), XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"), OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1" }
for (const key of Object.keys(env)) if (/(API[_-]?KEY|_TOKEN$|_SECRET$|PASSWORD|OPENCODE_CONFIG$|OPENCODE_DB$)/i.test(key)) delete env[key]
for (const directory of [project, config, join(config, "agents"), env.HOME!, evidence]) await mkdir(directory, { recursive: true })
const requests: Array<{ marker: string; tools: number; sawResult: boolean; generation: boolean; toolNames: string[] }> = []
let release: (() => void) | undefined
let blocked = "", workerCalls = 0
const blockedCases = new Set<string>()
const heldWorkers: Array<() => void> = []
function example(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const schema = value as { const?: unknown; enum?: unknown[]; type?: string; properties?: Record<string, unknown>; required?: string[]; items?: unknown; anyOf?: unknown[]; oneOf?: unknown[] }
  if (schema.const !== undefined) return schema.const
  if (schema.enum?.length) return schema.enum[0]
  const variants = schema.anyOf ?? schema.oneOf
  if (variants?.length) return example(variants[0])
  if (schema.type === "array") return [example(schema.items)]
  if (schema.type === "object" || schema.properties) return Object.fromEntries((schema.required ?? Object.keys(schema.properties ?? {})).map(key => [key, example(schema.properties?.[key])]))
  return schema.type === "boolean" ? true : schema.type === "number" || schema.type === "integer" ? 1 : "Probe question"
}
const model = Bun.serve({ port: 0, fetch: async (request) => {
  if (request.method === "GET") return Response.json({ data: [{ id: "qa", object: "model", created: 0, owned_by: "momo-qa" }] })
  const body = await request.json() as { model: string; messages: Array<{ role: string; content: unknown }>; tools?: Array<{ function?: { name?: string; parameters?: unknown } }> }
  const text = JSON.stringify(body.messages)
  const caseIndex = body.messages.findLastIndex(message => message.role === "user" && /CASE_[A-Z]+/.test(JSON.stringify(message.content)))
  const caseText = caseIndex >= 0 ? JSON.stringify(body.messages[caseIndex].content) : ""
  const marker = caseText.match(/CASE_[A-Z]+/)?.[0] ?? "DEPARTMENT"
  const tools = body.messages.slice(caseIndex + 1).filter(message => message.role === "tool").length
  const generation = body.tools?.some(tool => tool.function?.name === "execute") === true
  const row = { marker, tools, sawResult: text.includes("CHILD_RESULT"), generation, toolNames: body.tools?.map(tool => tool.function?.name ?? "unknown") ?? [] }; requests.push(row)
  if (generation && marker !== "DEPARTMENT" && marker !== "CASE_CANCEL" && tools === 1 && !blockedCases.has(marker)) {
    blocked = marker; blockedCases.add(marker)
    await new Promise<void>(resolve => { release = resolve })
  }
  const department = integrated && marker === "DEPARTMENT" && text.includes("NATIVE_DEPT_PARENT")
  const worker = integrated && !department && text.includes("NATIVE_") && marker === "DEPARTMENT"
  if (worker && generation) workerCalls++
  const slow = worker && generation && /NATIVE_CANCEL_[AB]/.test(text)
  if (slow) await new Promise<void>(resolve => heldWorkers.push(resolve))
  const questionTool = body.tools?.find(tool => tool.function?.name === "question")?.function
  const ask = worker && text.includes("NATIVE_FORM_CHILD") && tools === 0 && questionTool !== undefined
  let code = "return 'tick'"
  if (integrated && tools === 0 && marker !== "DEPARTMENT") {
    const prompt = marker === "CASE_FORM" ? "NATIVE_FORM_CHILD" : marker === "CASE_LEGACY" ? "NATIVE_LEGACY_CHILD" : marker === "CASE_DEPARTMENT" ? "NATIVE_DEPT_PARENT" : "NATIVE_INTEGRATED_CHILD"
    code = `return JSON.parse(await tools.momo_task({action:"create",prompt:${JSON.stringify(prompt)}}))`
  }
  if (marker === "CASE_CANCEL" && tools === 0) {
    const ids = caseText.match(/CANCEL_IDS:([A-Za-z0-9_,:-]+)/)?.[1].split(",") ?? []
    if (ids.length !== 2) throw new Error("Cancel fixture requires two exact child IDs")
    code = ids.map(taskID => `await tools.momo_task({action:"cancel",taskID:${JSON.stringify(taskID)}})`).join(";") + ";return 'cancelled'"
  }
  if (department && tools === 0) code = `return await Promise.all(['NATIVE_CANCEL_A','NATIVE_CANCEL_B'].map(async prompt=>JSON.parse(await tools.momo_task({action:'create',prompt}))))`
  if (worker && !ask) await Bun.sleep(250)
  const call = department && generation && tools === 0 || ask || generation && marker !== "DEPARTMENT" && tools < 3
  const delta = ask ? { tool_calls: [{ index: 0, id: "call_" + crypto.randomUUID().replaceAll("-", ""), type: "function", function: { name: "question", arguments: JSON.stringify(example(questionTool.parameters)) } }] } : call ? { tool_calls: [{ index: 0, id: "call_" + crypto.randomUUID().replaceAll("-", ""), type: "function", function: { name: "execute", arguments: JSON.stringify({ code }) } }] } : { content: department ? text.includes(": cancelled") ? "DEPT_AGGREGATED" : "DEPT_WAITING" : worker ? "CHILD_RESULT_COMPLETED" : "PROBE_DONE" }
  const chunk = (value: unknown, finish: unknown) => ({ id: "qa", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: value, finish_reason: finish }] })
  return new Response(`data: ${JSON.stringify(chunk(delta, null))}\n\ndata: ${JSON.stringify(chunk({}, call ? "tool_calls" : "stop"))}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
} })
const jev = Bun.serve({ port: 0, fetch: async request => {
  const body = await request.json() as { state?: unknown; questions: { candidate: { criteria: Record<string, string> } } }
  const choices = Object.keys(body.questions.candidate.criteria)
  const state = (typeof body.state === "string" ? JSON.parse(body.state) : body.state) as { input?: { prompt?: string } }
  const role = state.input?.prompt === "NATIVE_DEPT_PARENT" ? "planner" : "worker"
  const choice = choices.find(key => key.startsWith(role + "|")) ?? choices[0]
  if (choice === undefined) throw new Error("Integrated fixture has no eligible candidate")
  return Response.json({ answers: { candidate: { type: "choice", choice, confidence: 1, probabilities: { [choice]: 1 } }, lane: { type: "choice", choice: role === "planner" ? "department" : "direct", confidence: 1, probabilities: role === "planner" ? { department: 1 } : { direct: 1 } } }, usage: { input_tokens: 13, output_tokens: 5 } })
} })
const plugin = join(root, "plugin"); await mkdir(plugin)
await writeFile(join(plugin, "package.json"), JSON.stringify({ name: "consumption-probe", type: "module", exports: { ".": "./index.js" } }))
await writeFile(join(plugin, "index.js"), `${integrated ? `import momo from ${JSON.stringify(join(worktree, "dist/index.js"))};` : ""}export default { id:'${integrated ? "oh-my-openagent" : "consumption-probe"}',async setup(ctx){
await ctx.provider.transform(editor=>editor.add({info:{id:'momo-qa',name:'QA',activation:'enabled',package:'aisdk:@ai-sdk/openai-compatible',settings:{baseURL:'http://127.0.0.1:${model.port}/v1',apiKey:'local-only'}},models:[{id:'qa',modelID:'qa',providerID:'momo-qa',name:'QA',capabilities:{tools:true,input:['text'],output:['text']},variants:[],time:{released:0},cost:[{input:0,output:0,cache:{read:0,write:0}}],status:'active',enabled:true,limit:{context:32000,output:4096}}]}));await ctx.provider.reload()
${integrated ? "return await momo.setup(ctx)" : ""}
}}`)
if (integrated) {
  await mkdir(join(project, ".omo"), { recursive: true }); await mkdir(join(env.HOME!, ".omo"), { recursive: true })
  await writeFile(join(project, ".omo/omo.jsonc"), JSON.stringify({ "[opencode]": { manager: { jev: { provider_id: "momo-qa", base_url: `http://127.0.0.1:${jev.port}/jev/v1`, model: "jev-1.13", max_attempts: 1 } } } }))
  await writeFile(join(env.HOME!, ".omo/model-pool.json"), JSON.stringify({ version: 1, allowed: [{ providerID: "momo-qa", modelID: "qa" }], updatedAt: new Date().toISOString() }))
}
if (!integrated) await writeFile(join(config, "agents/momo-orchestrator.md"), "---\nmode: primary\ndescription: Isolated native consumption probe\n---\nFollow probe instructions.\n")
await writeFile(join(config, "opencode.json"), JSON.stringify({ plugins: [`file:${plugin}`], model: "momo-qa/qa", agent: "momo-orchestrator" }))
await writeFile(join(config, "service.json"), JSON.stringify({ password: "local-qa" }))
const reservation = Bun.serve({ port: 0, fetch: () => new Response("") }); const port = reservation.port; reservation.stop(true)
const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${port}`, headers: { authorization: "Basic " + Buffer.from("opencode:local-qa").toString("base64") } })
let output = ""
const ownedGroups: number[] = []
let proc: ReturnType<typeof spawn> | undefined
async function start() {
  proc = spawn(bin!, ["serve", "--service", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: project, env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
  if (proc.pid) ownedGroups.push(proc.pid)
  proc.stdout?.on("data", chunk => { output += chunk }); proc.stderr?.on("data", chunk => { output += chunk })
  await poll(async () => (await client.plugin.list({ location: { directory: project } })).data.some(row => row.id === (integrated ? "oh-my-openagent" : "consumption-probe") && row.state.status === "active"))
}
async function stop() {
  const owned = proc
  if (owned?.pid && owned.exitCode === null && owned.signalCode === null) { process.kill(-owned.pid, "SIGTERM"); await new Promise(resolve => owned.once("exit", resolve)) }
}
async function poll(predicate: () => Promise<boolean>, timeout = 45000) {
  const until = Date.now() + timeout
  while (Date.now() < until) { try { if (await predicate()) return } catch (error) { if (Date.now() + 100 >= until) throw error }; await Bun.sleep(50) }
  throw new Error("Timed out waiting for native proof")
}
const repository = createFileNativeTaskRepository(join(root, "tasks.json"))
const runtime = () => createNativeSessionRuntime({ client, repository, resolveOwnedRole: () => "orchestrator", resolveOwnedAgentID: () => "momo-orchestrator", verifySessionOwner: async () => undefined,
  onParentAnswer: async (taskID, questionID, answer) => {
    const current = await repository.get(taskID)
    if (!current?.sessionID) throw new Error("Native question lost its child")
    current.answer = answer; current.answerStatus = "sent"; current.state = "queued"; await repository.save(current)
    await bridge.answer({ sessionID: current.sessionID, questionID, answer })
  },
})
const bridge = runtime()
function task(id: string, parent: string, rootSessionID = parent, parentTaskID?: string): NativeTask {
  return { id, rootTaskID: id, rootSessionID, parentSessionID: parent, ...(parentTaskID ? { parentTaskID } : {}), kind: "task", parentRole: "orchestrator", role: "worker", model: { providerID: "momo-qa", id: "qa" }, state: "succeeded", prompt: "probe", createdAt: 1, updatedAt: 1, attempts: 1, activeTools: [], childTaskIDs: [], processedEventIDs: [], lastActivityAt: 1 }
}
const results: Record<string, unknown> = {}
const eventRows: unknown[] = []
const abort = new AbortController()
let events: Promise<void> | undefined
try {
  await start()
  events = (async () => { while (!abort.signal.aborted) { try { for await (const event of client.event.subscribe({ signal: abort.signal })) {
    if (event.type === "session.execution.started" || event.type === "session.execution.succeeded") eventRows.push({ native: event })
    if (event.type === "session.inbox.delivered") eventRows.push({ native: event, mapped: mapV2TaskEvent(event) })
    if (event.type === "form.replied") { if (!integrated) await bridge.onFormEvent(event); eventRows.push({ native: event }) }
  } } catch (error) { if (!abort.signal.aborted) { eventRows.push({ transportReconnect: String(error) }); await Bun.sleep(200) } } } })()
  results.version = (await client.server.info()).version
  results.sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, createHash("sha256").update(await readFile(join(worktree, "packages/omo-opencode/src", path))).digest("hex")])))
  const dbPaths = new Set<string>()
  const owned = execFileSync("ps", ["-Ao", "pid=,pgid="], { encoding: "utf8" }).split("\n").flatMap(row => { const [pid, group] = row.trim().split(/\s+/).map(Number); return group === proc?.pid ? [pid] : [] })
  for (const pid of owned) for (const fd of await readdir("/proc/" + pid + "/fd")) {
    try { const path = await readlink("/proc/" + pid + "/fd/" + fd); if (/opencode.*\.db(?:-(?:wal|shm))?$/.test(path)) dbPaths.add(path) }
    catch (error) { if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error }
  }
  if (!dbPaths.size || [...dbPaths].some(path => !path.startsWith(root + "/"))) throw new Error("Database isolation was not established")
  results.databasePaths = [...dbPaths]
  if (integrated) {
    results.bundleHash = createHash("sha256").update(await readFile(join(worktree, "dist/index.js"))).digest("hex")
    results.integration = await proveBuiltNativeConsumption({ client, project, home: env.HOME!, blocked: () => blocked, release: () => release?.(), workerCalls: () => workerCalls,
      generations: sessionID => eventRows.filter(row => { const event = (row as { native?: { type: string; data?: { sessionID?: string } } }).native; return event?.type === "session.execution.started" && event.data?.sessionID === sessionID }).length,
      releaseWorkers: () => { for (const resolve of heldWorkers.splice(0)) resolve() },
      restart: async mutate => { await stop(); release?.(); await mutate(); await start() },
    })
    results.status = "passed"
  } else {
  async function busyCase(name: "BASELINE" | "FIXED" | "QUESTION") {
    blocked = ""; release = undefined
    const session = await client.session.create({ location: { directory: project }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "qa" } })
    const pending = client.session.prompt({ sessionID: session.id, text: "CASE_" + name })
    await poll(async () => blocked === "CASE_" + name && release !== undefined)
    return { session, pending }
  }
  const baseline = await busyCase("BASELINE")
  const baselineTask = task("ntask_legacy", baseline.session.id)
  await repository.save(baselineTask)
  const baselineID = bridge.deliveryMessageID!(baselineTask.id)
  await client.session.synthetic({ sessionID: baseline.session.id, id: baselineID, text: "CHILD_RESULT", description: "Baseline queued result", delivery: "queue", resume: true })
  const baselineQueuedWhileBusy = (await client.session.inbox.list({ sessionID: baseline.session.id })).some(row => row.id === baselineID)
  release!(); await baseline.pending; await client.session.wait({ sessionID: baseline.session.id })
  const baselineRows = requests.filter(row => row.marker === "CASE_BASELINE")
  if (!baselineQueuedWhileBusy || baselineRows.filter(row => row.tools < 3).some(row => row.sawResult) || baselineRows.find(row => row.tools === 3)?.sawResult) throw new Error("Baseline queue entered the ongoing busy generation unexpectedly")
  results.baseline = { queuedWhileBusy: true, observedByBusyGeneration: false, pendingAfterIdle: (await client.session.inbox.list({ sessionID: baseline.session.id })).length, nativeDrainsAfterGeneration: true }
  const legacyParent = await client.session.create({ location: { directory: project }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "qa" } })
  const legacyTask = task("ntask_idle_legacy", legacyParent.id); await repository.save(legacyTask)
  const legacyID = bridge.deliveryMessageID!(legacyTask.id)
  await client.session.synthetic({ sessionID: legacyParent.id, id: legacyID, text: "CHILD_RESULT", delivery: "queue", resume: false })
  await bridge.deliver({ taskID: legacyTask.id, parentSessionID: legacyParent.id, result: "CHILD_RESULT" })
  await client.session.wait({ sessionID: legacyParent.id })
  await poll(async () => await bridge.inspectDelivery!({ parentSessionID: legacyParent.id, messageID: legacyID }) === "delivered")
  if ((await client.session.context({ sessionID: legacyParent.id })).filter(row => row.id === legacyID).length !== 1 || (await client.session.inbox.list({ sessionID: legacyParent.id })).length) throw new Error("Historic queued stable ID was not recovered exactly once")
  results.legacyRecovery = { sameMessageID: legacyID, consumedExactlyOnce: true, pendingInbox: 0 }
  const fixed = await busyCase("FIXED"), fixedTask = task("ntask_fixed", fixed.session.id)
  await repository.save(fixedTask)
  const receipt = await bridge.deliver({ taskID: fixedTask.id, parentSessionID: fixed.session.id, result: "CHILD_RESULT" })
  const resultID = bridge.deliveryMessageID!(fixedTask.id)
  if (receipt?.status !== "admitted") throw new Error("Admission was reported as consumption")
  release!(); await fixed.pending; await client.session.wait({ sessionID: fixed.session.id })
  await poll(async () => eventRows.some(row => JSON.stringify(row).includes(resultID)))
  const fixedContext = await client.session.context({ sessionID: fixed.session.id })
  if (fixedContext.filter(row => row.id === resultID).length !== 1 || (await client.session.inbox.list({ sessionID: fixed.session.id })).length !== 0 || !requests.some(row => row.marker === "CASE_FIXED" && row.sawResult)) throw new Error("Steered result was not consumed exactly once in the busy model loop")
  results.fixed = { receipt, messageID: resultID, contextOccurrences: 1, pendingInbox: 0, observedByBusyModel: true }
  const department = await client.session.create({ location: { directory: project }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "qa" } })
  const children = [task("ntask_child_a", department.id, fixed.session.id, "ntask_department"), task("ntask_child_b", department.id, fixed.session.id, "ntask_department")]
  const callsBefore = requests.filter(row => row.generation).length
  for (const child of children) { await repository.save(child); await bridge.deliver({ taskID: child.id, parentSessionID: department.id, result: "CHILD_RESULT " + child.id }) }
  if (requests.filter(row => row.generation).length !== callsBefore || (await client.session.inbox.list({ sessionID: department.id })).length !== 2) throw new Error("Individual children woke the department")
  await bridge.continueParent({ sessionID: department.id, taskID: "ntask_department", wakeID: "children-a-b", childTaskIDs: children.map(child => child.id), message: children.map(child => "CHILD_RESULT " + child.id).join("\n") })
  await client.session.wait({ sessionID: department.id })
  const departmentContext = await client.session.context({ sessionID: department.id })
  if (children.some(child => !JSON.stringify(departmentContext).includes("CHILD_RESULT " + child.id)) || requests.filter(row => row.generation).length !== callsBefore + 1 || (await client.session.inbox.list({ sessionID: department.id })).length) throw new Error("Department batching did not produce one generation with both children")
  results.department = { children: 2, modelGenerations: 1, pendingInbox: 0 }
  const question = await busyCase("QUESTION"), questioned = task("ntask_question", question.session.id)
  const childSession = await client.session.create({ location: { directory: project }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "qa" } })
  questioned.sessionID = childSession.id
  questioned.state = "waiting_question"; questioned.questionEscalated = false; questioned.question = { id: "frm_child", prompt: "Which project?", form: { fields: [{ key: "projectName", type: "string", required: true }] } }
  await repository.save(questioned)
  await client.session.form.create({ sessionID: childSession.id, id: questioned.question.id, title: questioned.question.prompt, fields: [{ key: "projectName", type: "string", required: true }] })
  await bridge.ask({ taskID: questioned.id, parentSessionID: question.session.id, question: questioned.question })
  const questionInbox = await client.session.inbox.list({ sessionID: question.session.id })
  if (questionInbox.length !== 1) throw new Error("Question notification never queued")
  await client.session.inbox.update({ sessionID: question.session.id, inboxID: questionInbox[0].id, delivery: "queue" })
  const parentForm = (await client.session.form.list({ sessionID: question.session.id }))[0]
  await client.session.form.reply({ sessionID: question.session.id, formID: parentForm.id, answer: { projectName: "accepted" } })
  await poll(async () => (await repository.get(questioned.id))?.answerStatus === "sent")
  await poll(async () => (await client.session.inbox.list({ sessionID: question.session.id })).length === 0)
  const answeredChildForm = await client.session.form.get({ sessionID: childSession.id, formID: questioned.question.id })
  if (answeredChildForm.state.status !== "answered") throw new Error("Parent native form answer did not reach the child form")
  if ((await client.session.inbox.list({ sessionID: question.session.id })).length || (await client.session.form.list({ sessionID: question.session.id })).length > 0) throw new Error("Resolved question notification/form survived")
  release!(); await question.pending; await client.session.wait({ sessionID: question.session.id })
  results.question = { retractedPendingNotification: true, closedForwardedForm: true, nativeChildFormAnswered: true, acceptedAnswer: (await repository.get(questioned.id))?.answer }
  const modelCalls = requests.length
  abort.abort(); await events.catch(error => { if (!abort.signal.aborted) throw error }); await stop(); await start()
  if (await runtime().inspectDelivery!({ parentSessionID: fixed.session.id, messageID: resultID }) !== "delivered" || requests.length !== modelCalls) throw new Error("Restart lost consumed identity or reran work")
  results.restart = { consumedIdentityRecovered: true, modelCallsUnchanged: true }
  results.status = "passed"
  }
} catch (error) { results.status = "failed"; results.error = String(error) } finally {
  release?.(); for (const resolve of heldWorkers.splice(0)) resolve(); abort.abort(); if (events) await events.catch(error => { if (!abort.signal.aborted) throw error }); await stop(); model.stop(true); jev.stop(true)
  const after = counts(), groups = execFileSync("ps", ["-Ao", "pgid="], { encoding: "utf8" })
  results.cleanup = { realDatabaseCountsBefore: before, realDatabaseCountsAfter: after, unchanged: JSON.stringify(before) === JSON.stringify(after), ownedGroups, ownedProcessGroupGone: ownedGroups.every(pid => !groups.split("\n").some(row => Number(row.trim()) === pid)) }
  await writeFile(join(evidence, "events.json"), JSON.stringify(eventRows, null, 2)); await writeFile(join(evidence, "service.log"), output); await writeFile(join(evidence, "model-requests.json"), JSON.stringify(requests, null, 2))
  await rm(root, { recursive: true, force: true }); results.disposableRootRemoved = !await Bun.file(join(root, "tasks.json")).exists()
  await writeFile(join(evidence, "result.json"), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results))
  if (results.status !== "passed") process.exitCode = 1
}
