#!/usr/bin/env bun
// MODIFIED: native selective discovery, brief views, worker consultation and parent answers.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { harness, until } from "./momo-native-job-classification-harness"
import { answerCode, contractFixture, contractReply, contractResponse, createCode, emptyCode, questionArguments, requestSummary, workerCode, type ContractRequest } from "./momo-native-tool-contract-fixture"
import type { JevRequest } from "./momo-native-job-classification-fixture"

type Row = Record<string, unknown>
const binary = process.env.MOMO_NATIVE_OPENCODE_BIN
assert(binary, "Set MOMO_NATIVE_OPENCODE_BIN to the real OpenCode 2.1.2 executable")
const evidence = process.env.MOMO_NATIVE_EVIDENCE_DIR ?? join(process.cwd(), ".omo/evidence/20261021-native-tool-contract/native")
await mkdir(evidence, { recursive: true })
const entry = join(process.cwd(), "dist/index.js")
async function sourceHashes() {
  const files = [entry, import.meta.path, join(process.cwd(), "script/qa/momo-native-tool-contract-fixture.ts")]
  async function walk(directory: string) { for (const name of await readdir(directory, { withFileTypes: true })) { const path = join(directory, name.name); if (name.isDirectory()) await walk(path); else if (!path.endsWith(".test.ts")) files.push(path) } }
  for (const path of ["packages/omo-opencode/src/native-runtime", "packages/omo-opencode/src/native-task", "packages/omo-opencode/assets/native-agents"]) await walk(join(process.cwd(), path))
  return Object.fromEntries(await Promise.all(files.map(async file => [file.replace(process.cwd() + "/", ""), createHash("sha256").update(await readFile(file)).digest("hex")])))
}
const result: Row = { status: "running", proof: "real native runtime with controlled HTTP model responses", realProviderProof: false, credentialsCopied: false, questionProof: "Deterministic model calls the advertised native question tool; parent answers through momo_task; not an autonomous model-quality proof", sourceHashesBefore: await sourceHashes() }
const rolePolicies = Object.fromEntries(await Promise.all([['root', 'orchestrator'], ['worker', 'worker'], ['advisor', 'advisor']].map(async ([model, role]) => {
  const markdown = await readFile(join(process.cwd(), `packages/omo-opencode/assets/native-agents/momo-${role}.md`), "utf8")
  return [model, markdown.split("<!-- momo-native-agent-owned:v1 -->")[1]!.trim()]
})))
const qa = await harness(binary, evidence, { allowConcurrentMessageWrites: true })
let client: Awaited<ReturnType<typeof qa.start>>, rootID = "", phase: "empty" | "full" = "empty", rootCreated = false, workerConsulted = false, rootAnswered = false, formCreated = false, rootProbeChecked = false
const requests: (ReturnType<typeof requestSummary> & { rolePolicyMatched?: boolean; rolePolicySHA256?: string })[] = [], jevRequests: { questions: string[] }[] = [], errors: string[] = []
async function tasks(): Promise<Row[]> {
  const response = await client.rpc.call({ rpcID: "momo.native", method: "tasks", input: { rootSessionID: rootID }, location: { directory: qa.project } })
  return (((response as { output?: unknown }).output ?? response) as { tasks: Row[] }).tasks
}
const server = Bun.serve({ port: 0, async fetch(request) {
  try {
    const path = new URL(request.url).pathname
    if (request.method === "GET" && path.endsWith("/models")) return Response.json({ data: ["root", "worker", "advisor"].map(id => ({ id })) })
    if (path.endsWith("/systemone")) { const body = await request.json() as JevRequest; jevRequests.push({ questions: Object.keys(body.questions) }); return Response.json(contractReply(body)) }
    const body = await request.json() as ContractRequest
    const policy = rolePolicies[body.model]
    const system = body.messages.filter(message => ["system", "developer"].includes(message.role)).map(message => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n")
    requests.push({ ...requestSummary(body), rolePolicyMatched: policy ? system.includes(policy) : undefined, rolePolicySHA256: policy ? createHash("sha256").update(policy).digest("hex") : undefined })
    const text = JSON.stringify(body.messages)
    if (!body.tools?.some(tool => tool.function?.name === "execute")) return contractResponse(body.model, { text: "CONTROLLED_NO_TOOL_REQUEST" })
    if (body.model === "advisor") return contractResponse(body.model, { text: "CONTRACT_ADVICE: request the missing input before continuing." })
    if (body.model === "root") {
      if (!text.includes("EMPTY_CONTRACT_PROBE") && !text.includes("FULL_CONTRACT_PROBE")) return contractResponse(body.model, { text: "CONTROLLED_WARMUP" })
      rootProbeChecked ||= text.includes("ROOT_CREATED")
      if (phase === "empty" && !body.messages.some(message => message.role === "tool")) return contractResponse(body.model, { code: emptyCode })
      if (phase === "full" && !rootCreated) { rootCreated = true; return contractResponse(body.model, { code: createCode }) }
      if (phase === "full" && formCreated && !rootAnswered) { rootAnswered = true; return contractResponse(body.model, { code: answerCode }) }
      return contractResponse(body.model, { text: "CONTRACT_ROOT_READY" })
    }
    assert.equal(body.model, "worker")
    if (!text.includes("CONTRACT_WORKER")) return contractResponse(body.model, { text: "CONTROLLED_WARMUP" })
    await until(async () => rootProbeChecked, Boolean, "root brief/full comparison", 15000)
    if (!workerConsulted) { workerConsulted = true; return contractResponse(body.model, { code: workerCode }) }
    assert(text.includes("WORKER_CONSULTED"), "Worker did not receive successful advisor receipt")
    if (!formCreated) {
      formCreated = true
      const question = body.tools?.find(tool => tool.function?.name === "question")?.function
      assert(question?.parameters, "Native worker question tool not advertised")
      result.questionTool = { name: question.name, schemaSHA256: createHash("sha256").update(JSON.stringify(question.parameters)).digest("hex"), schemaBytes: Buffer.byteLength(JSON.stringify(question.parameters)) }
      return contractResponse(body.model, { tool: { name: "question", arguments: questionArguments(question.parameters) } })
    }
    return contractResponse(body.model, { text: "CONTRACT_WORKER_FINISHED_WITH_ADVICE_AND_ANSWER" })
  } catch (error) { errors.push(String(error)); return Response.json({ error: String(error) }, { status: 500 }) }
} })
try {
  const url = `http://127.0.0.1:${server.port}`
  await writeFile(join(qa.plugin, "package.json"), JSON.stringify({ name: "momo-contract-qa", type: "module", exports: { ".": "./index.js" } }))
  await writeFile(join(qa.plugin, "index.js"), contractFixture(entry, url))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "service.json"), JSON.stringify({ password: "local-qa" }))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "opencode.json"), JSON.stringify({ plugins: [`file:${qa.plugin}`], model: "contract/root", agent: "momo-orchestrator" }))
  await writeFile(join(qa.env.HOME!, ".omo/model-pool.json"), JSON.stringify({ version: 1, allowed: ["root", "worker", "advisor"].map(modelID => ({ providerID: "contract", modelID })), updatedAt: new Date().toISOString() }))
  async function config(advisors: { providerID: string; id: string }[]) {
    await writeFile(join(qa.project, ".omo/omo.jsonc"), JSON.stringify({ "[opencode]": { catalog: { auto_research: false }, manager: { jev: { provider_id: "contract", base_url: url + "/jev/v1", model: "manager", max_attempts: 1 }, advisor_models: advisors } } }))
  }
  async function newRoot(marker: string) {
    const session = await client.session.create({ location: { directory: qa.project }, agent: "momo-orchestrator", model: { providerID: "contract", id: "root" } })
    rootID = session.id
    await client.session.prompt({ sessionID: session.id, text: marker })
    await client.session.wait({ sessionID: session.id })
    return JSON.stringify(await client.session.context({ sessionID: session.id }))
  }
  await config([]); client = await qa.start(); result.version = (await client.server.info()).version
  const installedPolicies: Record<string, string> = {}
  for (const name of await readdir(join(process.cwd(), "packages/omo-opencode/assets/native-agents"))) {
    if (!name.endsWith(".md")) continue
    const expected = await readFile(join(process.cwd(), "packages/omo-opencode/assets/native-agents", name))
    const installed = await readFile(join(qa.env.OPENCODE_CONFIG_DIR!, "agents", name))
    assert(expected.equals(installed), "Installed owned policy differs: " + name)
    installedPolicies[name] = createHash("sha256").update(installed).digest("hex")
  }
  result.installedPolicies = installedPolicies
  assert(String(result.version).startsWith("2.1."), "This scenario must exercise native 2.1.x")
  const empty = await newRoot("EMPTY_CONTRACT_PROBE")
  assert(empty.includes("EMPTY_CONTRACT_PASSED"), "Actual Code Mode did not prove empty advisor capabilities")
  result.emptyAdvisorPool = true
  await qa.stop(); phase = "full"; await config([{ providerID: "contract", id: "advisor" }]); client = await qa.start()
  const created = await newRoot("FULL_CONTRACT_PROBE")
  if (!created.includes("ROOT_CREATED")) await writeFile(join(evidence, "controlled-root-context.json"), created)
  assert(created.includes("ROOT_CREATED"), "Root did not complete discovery/create/brief checks")
  const waiting = await until(tasks, rows => rows.some(row => row.prompt === "CONTRACT_WORKER" && (row.state === "waiting_question" || row.state === "succeeded")), "worker advice and question", 45000)
  const original = waiting.find(row => row.prompt === "CONTRACT_WORKER")!; assert(typeof original.sessionID === "string")
  if (original.state === "waiting_question" && !rootAnswered) { await client.session.prompt({ sessionID: rootID, text: "ANSWER_CONTRACT_PROBE" }); await client.session.wait({ sessionID: rootID }) }
  const completed = await until(tasks, rows => rows.some(row => row.prompt === "CONTRACT_WORKER" && row.state === "succeeded"), "same worker completion", 45000)
  const worker = completed.find(row => row.prompt === "CONTRACT_WORKER")!, advisor = completed.find(row => row.kind === "consultation" && row.state === "succeeded")!
  assert(advisor && (advisor.model as { id: string }).id === "advisor", "Distinct advisor model was not used")
  assert.equal(advisor.parentSessionID, worker.sessionID, "Consultation did not originate from worker")
  assert(worker.question && worker.answerStatus === "sent" && worker.answer !== undefined, "Native question was not actually answered")
  assert.equal(worker.sessionID, original.sessionID); assert.equal(completed.filter(row => row.prompt === "CONTRACT_WORKER").length, 1);
  // Answering queues the existing session through scheduler admission: start + answer continuation.
  assert.equal(worker.attempts, 2); assert(rootAnswered && formCreated && result.questionTool)
  assert.equal(errors.length, 0, "Controlled HTTP failures")
  for (const model of ["root", "worker", "advisor"]) assert(requests.some(row => row.model === model && row.rolePolicyMatched), "Updated owned role policy missing from provider request: " + model)
  result.status = "passed"; result.worker = { id: worker.id, sessionID: worker.sessionID, state: worker.state, attempts: worker.attempts }; result.advisor = { id: advisor.id, model: advisor.model }; result.nativeFormAnswered = true; result.sameSessionCompletion = true
} catch (error) { result.status = "failed"; result.error = String(error); throw error }
finally {
  result.requests = requests; result.routing = jevRequests; result.fixtureErrors = errors
  let finalFailure: unknown
  try { result.sourceHashesAfter = await sourceHashes(); assert.deepEqual(result.sourceHashesAfter, result.sourceHashesBefore) }
  catch (error) { result.status = "failed"; result.sourceError = String(error); finalFailure = error }
  try { result.cleanup = await qa.cleanup() }
  catch (error) { result.status = "failed"; result.cleanupError = String(error); finalFailure = error }
  finally { server.stop(true); await writeFile(join(evidence, "receipt.json"), JSON.stringify(result, null, 2) + "\n") }
  if (finalFailure) throw finalFailure
}
console.log(JSON.stringify({ status: result.status, version: result.version, emptyAdvisorPool: result.emptyAdvisorPool, sameSessionCompletion: result.sameSessionCompletion }))
