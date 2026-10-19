#!/usr/bin/env bun
// MODIFIED: prove public Jev, source-backed catalog and real free worker in isolated native OpenCode.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createJsonlNativeRouterStore } from "../../packages/omo-opencode/src/native-routing/jsonl-store"
import { harness, until } from "./momo-native-job-classification-harness"

assert(process.env.MOMO_LIVE_FREE_JEV === "1", "Explicitly opt in with MOMO_LIVE_FREE_JEV=1")
const binary = process.env.MOMO_NATIVE_OPENCODE_BIN
assert(binary, "Set MOMO_NATIVE_OPENCODE_BIN to the real native executable")
const evidence = process.env.MOMO_NATIVE_EVIDENCE_DIR ?? join(process.cwd(), ".omo/evidence/20261019-free-jev-catalog/native")
await mkdir(evidence, { recursive: true })
const entry = join(process.cwd(), "dist/index.js")
const metadataFile = process.env.MOMO_NATIVE_MODELS_SOURCE_FILE
let metadataText: string, sourceFetchedAt = Date.now()
if (metadataFile) {
  sourceFetchedAt = (await stat(metadataFile)).mtimeMs
  assert(Date.now() - sourceFetchedAt < 24 * 60 * 60 * 1000, "Official metadata fixture is stale")
  metadataText = await readFile(metadataFile, "utf8")
} else {
  const response = await fetch("https://models.dev/api.json", { signal: AbortSignal.timeout(15000) })
  assert(response.ok)
  metadataText = await response.text()
}
type ModelMetadata = { id: string; name: string; tool_call: boolean; modalities: { input: string[]; output: string[] }; limit: { context: number; output: number }; cost: { input: number; output: number } }
const metadata = JSON.parse(metadataText) as { opencode: { api: string; npm: string; models: Record<string, ModelMetadata> } }
const modelID = "mimo-v2.6-flash-free"
const candidateIDs = (process.env.MOMO_NATIVE_FREE_MODELS ?? modelID).split(",")
assert(candidateIDs.length > 0 && candidateIDs.length <= 4)
const model = metadata.opencode.models[modelID]
assert(model && model.cost.input === 0 && model.cost.output === 0)
for (const id of candidateIDs) assert(metadata.opencode.models[id]?.cost.input === 0 && metadata.opencode.models[id]?.cost.output === 0)
const qa = await harness(binary, evidence, { allowConcurrentMessageWrites: true })
const realRoot = process.env.MOMO_LIVE_FREE_ROOT === "1"
const builtinCatalog = process.env.MOMO_NATIVE_BUILTIN_CATALOG !== "0"
let rootCalls = 0
const prompt = "Fix the TypeScript add(a,b) function in arithmetic.ts: it currently subtracts, it must return a+b. Run bun test arithmetic.test.ts. This is a small coding implementation. Do not delegate."
const server = Bun.serve({ port: 0, async fetch(request) {
  if (new URL(request.url).pathname.endsWith("/models")) return Response.json({ data: [{ id: "root" }] })
  const body = await request.json() as { model: string; messages: { role: string }[]; tools?: { function?: { name?: string } }[] }
  rootCalls++
  const call = !body.messages.some(message => message.role === "tool") && body.tools?.some(tool => tool.function?.name === "execute")
  const delta = call ? { tool_calls: [{ index: 0, id: "call_" + crypto.randomUUID().replaceAll("-", ""), type: "function", function: { name: "execute", arguments: JSON.stringify({ code: `return JSON.parse(await tools.momo_task({action:'create',prompt:${JSON.stringify(prompt)}}))` }) } }] } : { content: "Native delegation submitted." }
  const chunk = (value: unknown, finish: unknown) => ({ id: "free-native-root", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: value, finish_reason: finish }] })
  return new Response(`data: ${JSON.stringify(chunk(delta, null))}\n\ndata: ${JSON.stringify(chunk({}, call ? "tool_calls" : "stop"))}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } })
} })
const result: Record<string, unknown> = { status: "running", rootModel: realRoot ? modelID : "controlled local delegation fixture", workerModel: modelID, jevModel: "jev-1.13-free", bundleSHA256: createHash("sha256").update(await readFile(entry)).digest("hex"), credentialsCopied: false, publishedMetadataFromVerifiedFile: metadataFile !== undefined, nativeProviderSource: builtinCatalog ? "builtin OpenCode registry" : "controlled source-backed provider fixture" }
async function scenario() {
try {
  await writeFile(join(qa.project, "arithmetic.ts"), "export function add(a: number, b: number) { return a - b }\n")
  await writeFile(join(qa.project, "arithmetic.test.ts"), "import {test,expect} from 'bun:test';import {add} from './arithmetic';test('adds',()=>expect(add(2,3)).toBe(5))\n")
  await writeFile(join(qa.plugin, "package.json"), JSON.stringify({ name: "momo-public-free-live-qa", type: "module", exports: { ".": "./index.js" } }))
  const nativeModels = candidateIDs.map(id => {
    const candidate = metadata.opencode.models[id]!
    return { id, modelID: id, providerID: "opencode", name: candidate.name, capabilities: { tools: candidate.tool_call, input: candidate.modalities.input, output: candidate.modalities.output }, variants: [], time: { released: 0 }, cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }], status: "active", enabled: true, limit: { context: candidate.limit.context, output: Math.min(candidate.limit.output, 8192) } }
  })
  const fixture = `import momo from ${JSON.stringify(entry)};import{writeFileSync}from"node:fs";
export default {id:'oh-my-openagent',async setup(ctx){
 const originalFetch=globalThis.fetch;const http=[];
 globalThis.fetch=Object.assign(async(input,init)=>{const url=typeof input==='string'?input:input instanceof URL?input.href:input.url;try{const response=await originalFetch(input,init);if(url.includes('/systemone')){http.push({url,status:response.status});writeFileSync(${JSON.stringify(join(evidence, "http-diagnostic.json"))},JSON.stringify(http,null,2));}return response;}catch(error){if(url.includes('/systemone')){http.push({url,error:String(error)});writeFileSync(${JSON.stringify(join(evidence, "http-diagnostic.json"))},JSON.stringify(http,null,2));}throw error;}},{preconnect:originalFetch.preconnect});
 await ctx.provider.transform(editor=>{
  ${builtinCatalog ? "" : "for(const row of editor.list())editor.remove(row.provider.id);"}
  editor.add({info:{id:'qa-root',name:'Controlled root',activation:'enabled',package:'aisdk:@ai-sdk/openai-compatible',settings:{baseURL:'http://127.0.0.1:${server.port}/v1'}},models:[{id:'root',modelID:'root',providerID:'qa-root',name:'root',capabilities:{tools:true,input:['text'],output:['text']},variants:[],time:{released:0},cost:[{input:1,output:1,cache:{read:0,write:0}}],status:'active',enabled:true,limit:{context:32000,output:4096}}]});
  ${builtinCatalog ? "" : `editor.add({info:{id:'opencode',integrationID:'opencode',name:'OpenCode public',activation:'enabled',package:${JSON.stringify("aisdk:" + metadata.opencode.npm)},settings:{baseURL:${JSON.stringify(metadata.opencode.api)}}},models:${JSON.stringify(nativeModels)}});`}
 });await ctx.provider.reload();
 const providers=(await ctx.provider.list()).data.map(p=>({id:p.id,integrationID:p.integrationID,package:p.package,activation:p.activation,baseURL:p.settings?.baseURL??p.settings?.baseUrl}));
 const models=(await ctx.model.list()).data.filter(m=>m.providerID==='opencode').map(m=>({id:m.id,modelID:m.modelID,providerID:m.providerID,package:m.package,enabled:m.enabled,status:m.status,capabilities:m.capabilities,cost:m.cost,limit:m.limit,baseURL:m.settings?.baseURL??m.settings?.baseUrl}));
 writeFileSync(${JSON.stringify(join(evidence, "native-registry.json"))},JSON.stringify({providers,models},null,2));
 return momo.setup(ctx)}};`
  await writeFile(join(qa.plugin, "index.js"), fixture)
  await writeFile(join(evidence, "fixture.js"), fixture)
  await writeFile(join(qa.env.HOME!, ".omo/model-pool.json"), JSON.stringify({ version: 1, allowed: candidateIDs.map(modelID => ({ providerID: "opencode", modelID })), updatedAt: new Date().toISOString() }))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "opencode.json"), JSON.stringify({ plugins: [`file:${qa.plugin}`], model: realRoot ? `opencode/${modelID}` : "qa-root/root", agent: "momo-orchestrator" }))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "service.json"), JSON.stringify({ password: "local-qa" }))
  if (builtinCatalog) {
    delete qa.env.OPENCODE_DISABLE_MODELS_FETCH
    const nativeCache = join(qa.env.XDG_CACHE_HOME!, "opencode")
    await mkdir(nativeCache, { recursive: true })
    await writeFile(join(nativeCache, "models.json"), JSON.stringify(metadata))
    if (metadataFile && process.env.MOMO_NATIVE_COLD_PUBLISHED !== "1") {
      await mkdir(join(qa.env.HOME!, ".omo/native"), { recursive: true })
      await writeFile(join(qa.env.HOME!, ".omo/native/published-models.json"), JSON.stringify({ fetchedAt: sourceFetchedAt, payload: metadata }))
    }
  }
  let client = await qa.start()
  result.version = (await client.server.info()).version
  const registry = JSON.parse(await readFile(join(evidence, "native-registry.json"), "utf8")) as { models: { id: string; enabled: boolean }[] }
  const registeredCandidates = candidateIDs.filter(id => registry.models.some(model => model.id === id && model.enabled))
  assert(registeredCandidates.length > 0, "No requested free candidates remain in the native registry")
  result.requestedCandidates = candidateIDs
  result.registeredCandidates = registeredCandidates
  result.removedCandidates = candidateIDs.filter(id => !registeredCandidates.includes(id))
  async function snapshot() {
    const response = await client.rpc.call({ rpcID: "momo.native", method: "catalogSnapshot", input: {}, location: { directory: qa.project } })
    const data = ((response as { output?: unknown }).output ?? response) as { snapshot: { models: { id: string; inputPricePerMillion?: number; published?: { description?: string } }[]; classifier: { completedProfiles?: number; running?: boolean; queued?: number } } }
    await writeFile(join(evidence, "catalog-last.json"), JSON.stringify(data, null, 2))
    return data
  }
  const catalog = await until(snapshot, data => !data.snapshot.classifier.running && !data.snapshot.classifier.queued && (data.snapshot.classifier.completedProfiles ?? 0) > 0, "real free Jev classification", 45000)
  await writeFile(join(evidence, "catalog.json"), JSON.stringify(catalog, null, 2))
  const row = catalog.snapshot.models.find(row => row.id === modelID)
  assert(row?.published?.description && row.inputPricePerMillion === 0, "Missing published description or verified free price")
  if (process.env.MOMO_NATIVE_CATALOG_ONLY === "1") { result.status = "passed"; result.catalogOnly = true; return }
  const session = await client.session.create({ location: { directory: qa.project }, agent: "momo-orchestrator", model: realRoot ? { providerID: "opencode", id: modelID } : { providerID: "qa-root", id: "root" } })
  await client.session.prompt({ sessionID: session.id, text: realRoot ? "Use momo_task to delegate exactly one small coding task: fix arithmetic.ts add(a,b), which incorrectly subtracts; it must add. Have the worker run bun test arithmetic.test.ts. Wait for completion and report the test result. Do not edit the file yourself." : "Delegate the isolated arithmetic repair task once." })
  const tasks = await until(async () => {
    const response = await client.rpc.call({ rpcID: "momo.native", method: "tasks", input: { rootSessionID: session.id }, location: { directory: qa.project } })
    const data = ((response as { output?: unknown }).output ?? response) as { tasks: { id: string; state: string; prompt: string; [key: string]: unknown }[] }
    await writeFile(join(evidence, "tasks.json"), JSON.stringify(data, null, 2))
    return data.tasks
  }, rows => rows.some(row => (realRoot || row.prompt === prompt) && ["succeeded", "failed", "awaiting_selection"].includes(row.state)), "actual free native worker", 120000)
  assert(tasks.some(row => (realRoot || row.prompt === prompt) && row.state === "succeeded"), "Free native delegation did not succeed: " + JSON.stringify(tasks))
  result.selectedWorker = tasks.find(row => row.state === "succeeded")?.model
  result.fixedSource = await readFile(join(qa.project, "arithmetic.ts"), "utf8")
  const test = Bun.spawn([process.execPath, "test", "arithmetic.test.ts"], { cwd: qa.project, env: qa.env, stdout: "pipe", stderr: "pipe" })
  result.workerTest = await new Response(test.stdout).text() + await new Response(test.stderr).text()
  assert.equal(await test.exited, 0, "Worker repair failed its actual unit test")
  const ledger = await client.rpc.call({ rpcID: "momo.native", method: "exportDecisions", input: {}, location: { directory: qa.project } })
  await writeFile(join(evidence, "ledger.json"), JSON.stringify(ledger, null, 2))
  const projectRoot = join(qa.env.HOME!, ".omo/native/projects", createHash("sha256").update(qa.project).digest("hex").slice(0, 24))
  const rawLedger = await readFile(join(projectRoot, "routing-ledger.jsonl"), "utf8")
  await writeFile(join(evidence, "routing-ledger.jsonl"), rawLedger)
  await writeFile(join(evidence, "job-classifications.json"), await readFile(join(projectRoot, "job-classifications.json")))
  assert(!rawLedger.includes('"model":"jev-1.13"'), "Paid Jev unexpectedly requested")
  const calls = new Map((await createJsonlNativeRouterStore(join(projectRoot, "routing-ledger.jsonl")).load()).filter(row => row.type === "jev_call").map(row => [row.callId, row]))
  assert(calls.size >= 2 && [...calls.values()].every(row => row.status === "complete" && row.usage?.costUsd === 0 && row.usage.inputTokens! > 0), "Free Jev accounting lost usage or reported a charge")
  result.jevCalls = [...calls.values()].map(row => ({ purpose: row.purpose, usage: row.usage }))
  await qa.stop()
  client = await qa.start()
  await Bun.sleep(1500)
  const restarted = await snapshot()
  assert.equal(restarted.snapshot.classifier.completedProfiles, catalog.snapshot.classifier.completedProfiles)
  const restartedLedger = await readFile(join(projectRoot, "routing-ledger.jsonl"), "utf8")
  assert.equal(restartedLedger, rawLedger, "Unchanged catalog was reclassified after restart")
  result.restartReclassified = false
  result.publishedCachePersisted = (await readFile(join(qa.env.HOME!, ".omo/native/published-models.json"))).length > 0
  result.status = "passed"
} catch (error) {
  result.status = "failed"; result.error = String(error)
  throw error
} finally {
  server.stop(true)
  result.rootCalls = rootCalls
  const projectRoot = join(qa.env.HOME!, ".omo/native/projects", createHash("sha256").update(qa.project).digest("hex").slice(0, 24))
  try { for (const name of await readdir(projectRoot)) if (/\.(json|jsonl)$/.test(name)) await writeFile(join(evidence, name), await readFile(join(projectRoot, name))) }
  catch (error) { result.artifactError = String(error) }
  try { await writeFile(join(evidence, "session-messages.json"), execFileSync("sqlite3", ["-readonly", "-json", join(qa.env.XDG_DATA_HOME!, "opencode/opencode.db"), "select session_id,type,data from session_message order by time_created"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 })) }
  catch (error) { result.messageArtifactError = String(error) }
  try { result.cleanup = await qa.cleanup() }
  catch (error) { result.cleanupError = String(error); result.status = "failed" }
  await writeFile(join(evidence, "receipt.json"), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
}
}
await scenario()
