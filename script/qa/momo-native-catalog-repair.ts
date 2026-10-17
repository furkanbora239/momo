import { mkdir, mkdtemp, writeFile, readFile, rm, readdir, readlink } from "node:fs/promises"
import { spawn, execFileSync } from "node:child_process"
import { join, isAbsolute } from "node:path"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"

type Row = Record<string, unknown>
const worktree = process.cwd()
const binary = process.env.MOMO_NATIVE_OPENCODE_BIN
const entry = process.env.MOMO_NATIVE_PLUGIN_ENTRY
if (!binary || !entry || !isAbsolute(binary) || !isAbsolute(entry)) throw new Error("Set absolute MOMO_NATIVE_OPENCODE_BIN and MOMO_NATIVE_PLUGIN_ENTRY")
const root = await mkdtemp(join(tmpdir(), "momo-catalog-repair-"))
const project = join(root, "project"), home = join(root, "home"), config = join(root, "config/opencode")
const evidence = join(worktree, ".omo/evidence/20261016-catalog-repair")
const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, OPENCODE_TEST_HOME: home, OPENCODE_CONFIG_DIR: config, XDG_DATA_HOME: join(root, "data"), XDG_CONFIG_HOME: join(root, "config"), XDG_STATE_HOME: join(root, "state"), XDG_CACHE_HOME: join(root, "cache"), OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1" }
for (const key of Object.keys(env)) if (/(API[_-]?KEY|_KEY$|_TOKEN$|_SECRET$|PASSWORD|OPENCODE_CONFIG$|OPENCODE_DB$)/i.test(key)) delete env[key]
for (const directory of [project, config, home, evidence, join(project, ".omo")]) await mkdir(directory, { recursive: true })
const database = join(process.env.HOME ?? "", ".local/share/opencode/opencode.db")
const counts = () => execFileSync("sqlite3", ["-readonly", database, "select 'session',count(*) from session union all select 'session_v2',count(*) from session_v2 union all select 'session_message',count(*) from session_message;"], { encoding: "utf8" }).trim()
const before = counts()
const ids = Array.from({ length: 53 }, (_, i) => "m" + i)
const requests: Row[] = [], jevRequests: Row[] = []
let boundRootBusy = false, privacyAssignmentsReady = false
const model = Bun.serve({ port: 0, fetch: async request => {
  if (new URL(request.url).pathname.endsWith("/models")) return Response.json({ data: ids.map(id => ({ id, object: "model" })) })
  const body = await request.json() as { model: string; messages: { role: string; content: unknown }[] }
  requests.push(body)
  const user = JSON.stringify(body.messages.filter(m => m.role === "user").at(-1)?.content)
  const lastRole = body.messages.at(-1)?.role
  const rootIndex = body.messages.findLastIndex(m => m.role === "user" && JSON.stringify(m.content).includes("ROOT_CREATE"))
  const rootUser = rootIndex >= 0 ? JSON.stringify(body.messages[rootIndex]?.content) : ""
  const rootHasReply = rootIndex >= 0 && body.messages.slice(rootIndex + 1).some(m => m.role === "tool")
  if (body.model === "m1") { await until(async () => privacyAssignmentsReady); return Response.json({ error: { message: "This model trains on request data. Privacy settings prohibit this model.", type: "policy_error" } }, { status: 400 }) }
  let call: { name: string; arguments: string } | undefined
  if (rootIndex >= 0 && !rootHasReply) {
    const code = rootUser.includes("PRIVACY")
      ? `const first = await tools.momo_task({action:"create",prompt:"PRIVACY_TASK_FIRST"}); const second = await tools.momo_task({action:"create",prompt:"PRIVACY_TASK_SECOND"}); const other = await tools.momo_task({action:"create",prompt:"RECOVERY_TASK_OTHER_MODEL"}); return {first,second,other};`
      : `return await tools.momo_task({action:"create",prompt:${JSON.stringify(rootUser.includes("BOUND") ? "BOUND_TASK" : "USER_TASK")}})`
    call = { name: "execute", arguments: JSON.stringify({ code }) }
  }
  if (lastRole === "user" && user.includes("Research published capabilities")) call = { name: "momo_catalog_enrich", arguments: JSON.stringify({ providerID: "catalog-qa", id: user.match(/catalog-qa\/(m\d+)/)?.[1] ?? "m0", summary: "Local source-backed fixture", sources: ["https://fixture.example/models/m0"] }) }
  if (rootHasReply) { if (rootUser.includes("PRIVACY")) privacyAssignmentsReady = true; boundRootBusy = rootUser.includes("BOUND"); await Bun.sleep(boundRootBusy ? 7000 : 2500); boundRootBusy = false }
  const delta = call ? { tool_calls: [{ index: 0, id: "call_" + crypto.randomUUID().replaceAll("-", ""), type: "function", function: call }] } : { content: "FIXTURE_COMPLETE" }
  const chunk = (delta: unknown, finish: unknown) => ({ id: "qa", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })
  return new Response(`data: ${JSON.stringify(chunk(delta, null))}\n\ndata: ${JSON.stringify(chunk({}, call ? "tool_calls" : "stop"))}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
} })
const jev = Bun.serve({ port: 0, fetch: async request => {
  const body = await request.json() as Row
  jevRequests.push(body)
  const selected = JSON.stringify(body.state).includes("RECOVERY_TASK_OTHER_MODEL") ? "m3" : JSON.stringify(body.state).includes("PRIVACY_TASK") ? "m1" : JSON.stringify(body.state).includes("BOUND_TASK") ? "m2" : "m0"
  const questions = body.questions as Record<string, { criteria: Record<string, string> }>
  const answers = Object.fromEntries(Object.entries(questions).map(([name, question]) => {
    const choice = name === "role" ? "worker" : name === "lane" ? "direct" : name === "group" ? Object.entries(question.criteria).find(([, facts]) => facts.includes(`"id":"${selected}"`))?.[0] : `worker|catalog-qa/${selected}`
    if (!choice || !(choice in question.criteria)) throw new Error(`Fixture cannot answer ${name} for ${selected}`)
    return [name, { type: "choice", choice, confidence: .99, probabilities: { [choice]: 1 } }]
  }))
  return Response.json({ model: "local-jev", answers, usage: { input_tokens: 19, output_tokens: 5 } })
} })
const plugin = join(root, "plugin")
await mkdir(plugin)
await writeFile(join(plugin, "package.json"), JSON.stringify({ name: "catalog-repair-fixture", type: "module", exports: { ".": "./index.ts" } }))
await writeFile(join(plugin, "index.ts"), `import {loadNativeRuntimeConfig} from ${JSON.stringify(join(worktree,"packages/omo-opencode/src/native-runtime/native-config.ts"))}; import momo from ${JSON.stringify(entry)}; export default {id:"oh-my-openagent",async setup(ctx){await ctx.provider.transform(editor=>editor.add({info:{id:"catalog-qa",name:"Local QA",activation:"enabled",package:"aisdk:@ai-sdk/openai-compatible",settings:{baseURL:"http://127.0.0.1:${model.port}/v1",apiKey:"local-only"}},models:${JSON.stringify(ids.map(id => ({ id, modelID: id, providerID: "catalog-qa", name: id, capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 }, cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }], status: "active", enabled: true, limit: { context: 32000, output: 4096 } })))} }));await ctx.provider.reload();console.log("CATALOG_QA_CONFIG",JSON.stringify({directory:ctx.location.directory,config:loadNativeRuntimeConfig(ctx.location.directory)}));return momo.setup(ctx)}}`)
await writeFile(join(config, "opencode.json"), JSON.stringify({ plugins: [`file:${plugin}`], model: "catalog-qa/m52", agent: "momo-orchestrator" }))
await writeFile(join(config, "service.json"), JSON.stringify({ password: "local-qa" }))
await mkdir(join(home, ".omo"), { recursive: true })
await writeFile(join(home, ".omo/model-pool.json"), JSON.stringify({ version: 1, allowed: ids.map(modelID => ({ providerID: "catalog-qa", modelID })), updatedAt: new Date().toISOString() }))
const ownedGroups: number[] = []
let service: ReturnType<typeof spawn> | undefined, output = "", port = 0
const results: Row = { status: "failed", bundleSHA256: createHash("sha256").update(await readFile(entry)).digest("hex"), realDatabaseCountsBefore: before }
async function settings(bound: boolean) {
  await writeFile(join(project, ".omo/omo.jsonc"), JSON.stringify({ "[opencode]": { background_task: { modelConcurrency: { "catalog-qa/m1": 1 } }, catalog: bound ? { research_executor: { providerID: "catalog-qa", modelID: "m52" } } : {}, manager: { jev: { provider_id: "catalog-qa", base_url: `http://127.0.0.1:${jev.port}/jev/v1`, model: "local-jev", max_attempts: 1 } } } }))
}
async function stop() {
  if (service?.pid && service.exitCode === null && service.signalCode === null) { process.kill(-service.pid, "SIGTERM"); await new Promise(resolve => service?.once("exit", resolve)) }
}
async function start() {
  const reserve = Bun.serve({ port: 0, fetch: () => new Response("") }); if (reserve.port === undefined) throw new Error("Missing reserved service port"); port = reserve.port; reserve.stop(true)
  service = spawn(binary!, ["serve", "--service", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: project, env, detached: true, stdio: ["ignore", "pipe", "pipe"] })
  if (service.pid) ownedGroups.push(service.pid)
  service.stdout?.on("data", value => output += value); service.stderr?.on("data", value => output += value)
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${port}`, headers: { authorization: "Basic " + Buffer.from("opencode:local-qa").toString("base64") } })
  await until(async () => { try { return (await client.plugin.list({ location: { directory: project } })).data.some(p => p.id === "oh-my-openagent" && p.state.status === "active") } catch { return false } }, 20000)
  const openedDatabases = new Set<string>()
  for (const pid of await readdir("/proc")) {
    if (!/^\d+$/.test(pid)) continue
    try {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8")
      if (!ownedGroups.includes(Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]))) continue
      for (const fd of await readdir(`/proc/${pid}/fd`)) {
        try { const target = await readlink(`/proc/${pid}/fd/${fd}`); if (target.endsWith("/opencode.db")) openedDatabases.add(target) }
        catch (error) { if (!(error instanceof Error)) throw error }
      }
    } catch (error) { if (!(error instanceof Error)) throw error }
  }
  if (!openedDatabases.size || [...openedDatabases].some(path => !path.startsWith(root + "/"))) throw new Error("Native QA database descriptor was absent or outside disposable root")
  results.openedDatabases = [...new Set([...(results.openedDatabases as string[] | undefined ?? []), ...openedDatabases])]
  return client
}
async function until(check: () => Promise<boolean>, timeout = 45000) { const deadline = Date.now() + timeout; while (Date.now() < deadline) { if (await check()) return; await Bun.sleep(150) }; throw new Error("Bounded native QA condition timed out") }
async function rpc(client: ReturnType<typeof OpenCode.make>, method: string, input: Record<string, string> = {}) {
  const result = await client.rpc.call({ rpcID: "momo.native", method, input, location: { directory: project } }) as { output?: Row }
  return (result.output ?? result) as Row
}
const queuePath = join(home, ".omo/native/projects", createHash("sha256").update(project).digest("hex").slice(0, 24), "catalog-maintenance.json")
const queue = async () => (JSON.parse(await readFile(queuePath, "utf8")) as { entries: Row[] }).entries
try {
  results.version = execFileSync(binary, ["--version"], { env, cwd: project, encoding: "utf8" }).trim()
  await settings(false)
  let client = await start()
  const initial = await rpc(client, "catalogSnapshot")
  const initialModels = (initial.snapshot as { models: { providerID: string; id: string }[] }).models.filter(m => m.providerID === "catalog-qa")
  results.initialCatalog = { eligibleFakeModels: initialModels.length, sample: initialModels.slice(0, 2) }
  if (initialModels.length !== 53) throw new Error("Expected 53 eligible local catalog models")
  const session = await client.session.create({ location: { directory: project }, agent: "momo-orchestrator", model: { providerID: "catalog-qa", id: "m52" } })
  await client.session.prompt({ sessionID: session.id, text: "ROOT_CREATE" }); await client.session.wait({ sessionID: session.id })
  await until(async () => { try { return (await queue()).length === 1 } catch { return false } })
  const unbound = await queue()
  if (unbound[0]?.status !== "paused" || unbound[0]?.reason !== "executor_unbound") throw new Error("Unbound research was not visibly paused")
  await until(async () => ((await rpc(client, "tasks", { rootSessionID: session.id })).tasks as Row[]).some(t => t.state === "succeeded"))
  const tasks = (await rpc(client, "tasks", { rootSessionID: session.id })).tasks as Row[]
  results.tasksDiagnostic = tasks.map(t => ({ id: t.id, state: t.state, role: t.role }))
  if (tasks.length !== 1 || tasks[0]?.state !== "succeeded") throw new Error("Snapshot fanout or user task failure")
  results.unbound = { queue: unbound, tasks: tasks.map(t => ({ id: t.id, state: t.state, role: t.role })) }
  await stop(); await rm(queuePath); results.startupEnqueueGap = "queue removed after durable dispatched task, repaired on restart"; await settings(true); client = await start()
  await until(async () => (await queue())[0]?.status === "completed")
  const boundTasks = (await rpc(client, "tasks", { rootSessionID: session.id })).tasks as Row[]
  const research = boundTasks.filter(t => t.maintenance)
  if (research.length !== 1 || research[0]?.state !== "succeeded" || research[0]?.delivery) throw new Error("Maintenance did not complete once without root delivery")
  const rootInbox = await client.session.inbox.list({ sessionID: session.id })
  const rootForms = await client.session.form.list({ sessionID: session.id })
  if (JSON.stringify([rootInbox, rootForms]).includes(String(research[0]?.id))) throw new Error("Headless research leaked a root notification")
  results.bound = { rootInbox: rootInbox.length, rootForms: rootForms.length, queue: await queue(), research: research.map(t => ({ id: t.id, state: t.state, model: t.model, delivery: t.delivery })) }
  const pending = client.session.prompt({ sessionID: session.id, text: "ROOT_CREATE_BOUND" })
  await until(async () => boundRootBusy && ((await rpc(client, "tasks", { rootSessionID: session.id })).tasks as Row[]).some(t => t.prompt === "BOUND_TASK" && t.state === "succeeded"))
  const duringBusy = (await rpc(client, "tasks", { rootSessionID: session.id })).tasks as Row[]
  if (duringBusy.filter(t => t.maintenance).length !== 1) throw new Error("Maintenance launched while the root generation was active")
  results.activeRootGuard = { ordinaryTaskState: "succeeded", maintenanceJobs: 1, active: (await client.session.active())[session.id] !== undefined }
  await pending; await client.session.wait({ sessionID: session.id })
  await until(async () => (await queue()).filter(q => q.status === "completed").length === 2)
  const beforeRestart = requests.filter(r => JSON.stringify(r).includes("Research published capabilities")).length
  await stop(); client = await start(); await Bun.sleep(1000)
  if (requests.filter(r => JSON.stringify(r).includes("Research published capabilities")).length !== beforeRestart) throw new Error("Completed research reran after restart")
  const privacyRun = client.session.prompt({ sessionID: session.id, text: "ROOT_CREATE_PRIVACY" })
  let privacyGuardPolls = 0
  await until(async () => {
    const privacyTasks = ((await rpc(client, "tasks", { rootSessionID: session.id })).tasks as Row[]).filter(t => String(t.prompt).startsWith("PRIVACY_TASK_"))
    const second = privacyTasks.find(t => t.prompt === "PRIVACY_TASK_SECOND")
    if (requests.filter(r => r.model === "m1").length > 1 || second?.sessionID) { results.privacyGuardFailure = { tasks: privacyTasks, modelExecutions: requests.filter(r => r.model === "m1").length }; throw new Error("A same-model queued task executed before policy observation resolved") }
    if (second) privacyGuardPolls++
    try {
      const policy = JSON.parse(await readFile(queuePath.replace("catalog-maintenance.json", "model-policy-health.json"), "utf8")) as { entries: { model: { id: string } }[] }
      return policy.entries.some(item => item.model.id === "m1")
    } catch (error) { if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return false; throw error }
  }, 45000)
  await privacyRun; await client.session.wait({ sessionID: session.id })
  const privacyTasks = ((await rpc(client, "tasks", { rootSessionID: session.id })).tasks as Row[]).filter(t => String(t.prompt).startsWith("PRIVACY_TASK_"))
  if (privacyTasks.length !== 2 || !privacyGuardPolls || requests.filter(r => r.model === "m1").length !== 1) throw new Error("Privacy queue fixture did not exercise two assignments with one model execution")
  await until(async () => ((await rpc(client, "tasks", { rootSessionID: session.id })).tasks as Row[]).some(t => t.prompt === "PRIVACY_TASK_SECOND" && t.state === "awaiting_selection"))
  await until(async () => ((await rpc(client, "tasks", { rootSessionID: session.id })).tasks as Row[]).some(t => t.prompt === "RECOVERY_TASK_OTHER_MODEL" && t.state === "succeeded"))
  results.otherModelContinued = requests.some(request => request.model === "m3")
  if (!results.otherModelContinued) throw new Error("Unaffected model did not execute while the rejected model was held")
  results.policyQueuedExecutionGuard = { queuedAssignments: 1, modelExecutions: 1, secondTaskState: "awaiting_selection", sampledGuardPolls: privacyGuardPolls, eventualPolicyTimeoutMs: 45000 }
  await until(async () => ((await rpc(client, "catalogSnapshot")).snapshot as { unavailableModels?: Row }).unavailableModels?.["catalog-qa/m1"] !== undefined)
  const policy = (await rpc(client, "catalogSnapshot")).snapshot as { models: { id: string; available: boolean }[]; unavailableModels: Row }
  if (policy.models.filter(m => !m.available).length !== 1 || policy.models.find(m => m.id === "m1")?.available !== false) throw new Error("Privacy rejection affected more than its actual model")
  const initialPolicyUntil = (policy.unavailableModels["catalog-qa/m1"] as { until: number }).until
  await stop(); client = await start()
  const replayPolicy = ((await rpc(client, "catalogSnapshot")).snapshot as { unavailableModels: Row }).unavailableModels
  if ((replayPolicy["catalog-qa/m1"] as { until: number }).until !== initialPolicyUntil) throw new Error("Reinspection of the old native failure extended its quarantine")
  results.policyReplayExpiryUnchanged = true
  results.policy = replayPolicy
  results.jevCalls = jevRequests.length
  results.status = "passed"
} catch (error) { results.error = String(error) } finally {
  privacyAssignmentsReady = true
  await stop(); model.stop(true); jev.stop(true)
  const groupsGone = () => !execFileSync("ps", ["-Ao", "pgid="], { encoding: "utf8" }).split("\n").some(row => ownedGroups.includes(Number(row.trim())))
  for (let i = 0; i < 30 && !groupsGone(); i++) await Bun.sleep(100)
  results.processGroupGone = groupsGone(); results.ownedProcessGroups = ownedGroups
  results.realDatabaseCountsAfter = counts(); results.realDatabaseUnchanged = results.realDatabaseCountsAfter === before
  await writeFile(join(evidence, "model-requests.json"), JSON.stringify(requests, null, 2)); await writeFile(join(evidence, "jev-requests.json"), JSON.stringify(jevRequests, null, 2)); await writeFile(join(evidence, "service.log"), output)
  await rm(root, { recursive: true, force: true }); results.disposableRootRemoved = !await Bun.file(queuePath).exists()
  if (!results.processGroupGone || !results.realDatabaseUnchanged) results.status = "failed"
  await writeFile(join(evidence, "summary.json"), JSON.stringify(results, null, 2))
  console.log(JSON.stringify({ status: results.status, error: results.error, evidence }))
  if (results.status !== "passed") process.exitCode = 1
}
