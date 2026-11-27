#!/usr/bin/env bun
// MODIFIED: exercise ordinary worker replacement on isolated OpenCode with loopback providers.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { NativeTask } from "../../packages/omo-opencode/src/native-task/types"
import type { NativeDecisionRecord } from "../../packages/omo-opencode/src/native-routing/types"
import { patchNodeRequireShim } from "../patch-node-require-shim"
import { harness, until } from "./momo-native-job-classification-harness"
import { sharedCatalogFixture } from "./momo-native-shared-catalog-fixture"
import { contractResponse, type ContractRequest } from "./momo-native-tool-contract-fixture"

const binary = process.env.OPENCODE_QA_BINARY ?? join(homedir(), ".opencode/bin/opencode")
const evidence = resolve(process.argv[2] ?? ".omo/evidence/native-worker-continuity")
const build = await mkdtemp(join(tmpdir(), "momo-worker-continuity-bundle-"))
const entry = join(build, "index.js")
const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex")
const save = (path: string, data: unknown) => writeFile(path, JSON.stringify(data, null, 2) + "\n")
await symlink(resolve("node_modules"), join(build, "node_modules"))
const bundle = Bun.spawnSync([process.execPath, "build", "packages/omo-opencode/src/index.ts", "--outfile", entry, "--target", "bun", "--format", "esm", "--external", "zod", "--external", "cross-spawn"])
assert.equal(bundle.exitCode, 0, bundle.stderr.toString())
await writeFile(entry, patchNodeRequireShim(await readFile(entry, "utf8"), entry).content)

const qa = await harness(binary, evidence, { allowConcurrentMessageWrites: true })
const project = { directory: qa.project }
const projectState = join(qa.env.HOME!, ".omo/native/projects", digest(qa.project).slice(0, 24))
const id = "mimo-v2.6-flash-free"
const rootProvider = "qa-expensive"
const models = [
  { providerID: rootProvider, id, price: 5 },
  { providerID: "qa-free", id, price: 0 },
  { providerID: "qa-free-alternate", id, price: 0 },
  { providerID: "qa-paid", id, price: 0.3 },
  { providerID: "qa-cheap", id, price: 0.1 },
  { providerID: "qa-exhausted", id, price: 0.3 },
  { providerID: "qa-worked", id, price: 0.3 },
]
const scenarios = [
  { name: "FREE", worker: "qa-free", alternate: "qa-free-alternate", attemptCount: 2, status: "succeeded" },
  { name: "PAID", worker: "qa-paid", alternate: "qa-cheap", attemptCount: 2, status: "succeeded" },
  { name: "EXHAUSTED", worker: "qa-exhausted", attemptCount: 1, status: "failed" },
  { name: "TOOL", worker: "qa-worked", alternate: "qa-cheap", attemptCount: 1, status: "failed" },
] as const
const initialRootRequests = new Set<string>()
const calls: { provider: string; marker: string; http: number }[] = []
const proof = {
  binarySHA256: digest(await readFile(binary)),
  bundleSHA256: digest(await readFile(entry)),
  version: "",
  calls, tasks: {} as Record<string, unknown>, health: undefined as unknown,
  restart: {} as Record<string, unknown>, cleanup: undefined as unknown, error: undefined as string | undefined,
}

function rootAssignment(marker: string, worker: string): string {
  return `
    const task = JSON.parse(await tools.momo_task({action:"create",prompt:${JSON.stringify(marker)},view:"brief"}));
    const menu = JSON.parse(await tools.momo_task({action:"candidates",taskID:task.id,role:"worker"}));
    const model = menu.candidates.find(row => row.model.providerID === ${JSON.stringify(worker)});
    if (!model) throw Error("Fixture worker missing from candidates");
    return await tools.momo_task({action:"select",taskID:task.id,decisionId:task.decisionId,role:"worker",providerID:model.model.providerID,modelID:model.model.id});
  `
}

const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname
  const provider = path.split("/")[1] ?? ""
  if (path.endsWith("/models")) return Response.json({ data: models.filter(row => row.providerID === provider).map(model => ({ id: model.id })) })
  if (request.method !== "POST") return new Response("", { status: 404 })
  const body = await request.json() as ContractRequest
  const text = JSON.stringify(body.messages)
  const scenario = scenarios.find(row => text.includes(`WORK_${row.name}`) || text.includes(`ROOT_${row.name}`))
  if (!scenario) return contractResponse(body.model, { text: "Fixture acknowledgement" })
  const marker = `WORK_${scenario.name}`
  if (provider === rootProvider && !initialRootRequests.has(scenario.name) && body.tools?.some(tool => tool.function?.name === "execute")) {
    initialRootRequests.add(scenario.name)
    return contractResponse(body.model, { code: rootAssignment(marker, scenario.worker) })
  }
  if (provider === rootProvider) return contractResponse(body.model, { text: "Root acknowledgement" })
  if (provider === scenario.worker) {
    if (scenario.name === "FREE") {
      calls.push({ provider, marker, http: 429 })
      return Response.json({ error: { name: "FreeUsageLimitError", code: "insufficient_quota", message: "Free usage limit reached" } }, { status: 429, headers: { "retry-after": "30" } })
    }
    if (scenario.name === "TOOL" && !body.messages.some(message => message.role === "tool")) {
      calls.push({ provider, marker, http: 200 })
      return contractResponse(body.model, { tool: { name: "shell", arguments: { command: "printf x >> side-effect.txt", description: "Write the isolated probe marker" } } })
    }
    calls.push({ provider, marker, http: 402 })
    return Response.json({ error: { name: "PaymentRequired", code: "insufficient_balance", message: "Insufficient prepaid balance" } }, { status: 402 })
  }
  calls.push({ provider, marker, http: 200 })
  return contractResponse(body.model, { text: "Worker fixture result" })
} })

try {
  await mkdir(projectState, { recursive: true })
  const modelFile = join(qa.root, "models.json")
  await save(modelFile, models)
  const fixture = sharedCatalogFixture(entry, `http://127.0.0.1:${provider.port}`, modelFile)
    .replace("aisdk:@ai-sdk/openai-compatible", "@opencode/ai/providers/openai-compatible")
    .replace("modelID:row.id,providerID:", "modelID:row.id,type:'chat',providerID:")
    .replace("const original=globalThis.fetch;", `const raw=globalThis.fetch;const original=Object.assign((input,init)=>{
      const url=new URL(input.url??input);
      if(url.hostname!=="127.0.0.1")throw Error("Non-loopback fixture request denied");
      return raw(input,init);
    },{preconnect:raw.preconnect});`)
  await writeFile(join(qa.plugin, "index.js"), fixture)
  await save(join(qa.plugin, "package.json"), { name: "momo-worker-continuity-qa", type: "module", exports: { ".": "./index.js" } })
  await save(join(qa.env.OPENCODE_CONFIG_DIR!, "opencode.json"), { plugins: [`file:${qa.plugin}`], model: `${rootProvider}/${id}` })
  await save(join(qa.env.OPENCODE_CONFIG_DIR!, "service.json"), { password: "local-qa" })

  let client = await qa.start()
  proof.version = (await client.server.info()).version
  async function tasksFor(rootSessionID: string): Promise<NativeTask[]> {
    const response = await client.rpc.call({ rpcID: "momo.native", method: "tasks", input: { rootSessionID }, location: project })
    return (response.output as { tasks: NativeTask[] }).tasks
  }
  const completed = new Map<string, NativeTask>()
  for (const scenario of scenarios) {
    const alternate = "alternate" in scenario ? [scenario.alternate] : []
    const allowed = [rootProvider, scenario.worker, ...alternate].map(providerID => ({ providerID, modelID: id }))
    await save(join(qa.env.HOME!, ".omo/model-pool.json"), { version: 1, allowed, updatedAt: new Date().toISOString() })
    const root = await client.session.create({ location: project, agent: "momo-orchestrator", model: { providerID: rootProvider, id } })
    await client.session.prompt({ sessionID: root.id, text: `ROOT_${scenario.name}`, resume: true })
    const tasks = await until(() => tasksFor(root.id), rows => rows.some(task => (task.state === "succeeded" || task.state === "failed") && task.outcomeStatus === "recorded"), scenario.name, 20_000).catch(async error => {
      proof.tasks[scenario.name] = { tasks: await tasksFor(root.id), context: await client.session.context({ sessionID: root.id }) }
      throw error
    })
    assert.equal(tasks.length, 1, "Exactly one durable task per root")
    const task = tasks[0]!
    assert.equal(task.state, scenario.status, task.error ?? scenario.name)
    assert.equal(task.attempts, scenario.attemptCount)
    const { id: taskID, sessionID, failedWorkerAttempt, error, decisionId } = task
    if (scenario.status === "succeeded") {
      assert(failedWorkerAttempt && failedWorkerAttempt.model.providerID === scenario.worker)
      assert.notEqual(failedWorkerAttempt.sessionID, sessionID)
      assert.equal(task.model?.providerID, scenario.alternate)
      const exported = await client.rpc.call({ rpcID: "momo.native", method: "exportDecisions", input: {}, location: project })
      const latest = new Map((exported.output as { lines: string[] }).lines.map(line => JSON.parse(line) as NativeDecisionRecord).filter(row => row.type === "decision").map(row => [row.decisionId, row]))
      assert.equal(latest.get(failedWorkerAttempt.decisionId)?.outcome?.result, "failure")
      const final = latest.get(decisionId!)
      assert.equal(final?.outcome?.result, "success")
      assert.equal(final?.outcome?.taskId, taskID)
      assert.equal(final?.request.input.sourceDecisionID, failedWorkerAttempt.decisionId)
      assert.equal(final?.jevCallId, undefined)
    } else {
      assert.equal(failedWorkerAttempt, undefined)
      assert.match(task.error ?? "", scenario.name === "TOOL" ? /may have started work/ : /Check provider funding/)
    }
    proof.tasks[scenario.name] = { taskID, rootSessionID: root.id, sessionID, decisionId, attempts: task.attempts, state: task.state, failedWorkerAttempt, error }
    completed.set(root.id, task)
    await client.session.wait({ sessionID: root.id })
  }
  assert.equal(await readFile(join(qa.project, "side-effect.txt"), "utf8"), "x")
  assert.deepEqual(calls.map(row => [row.provider, row.http]), [
    ["qa-free", 429], ["qa-free-alternate", 200], ["qa-paid", 402], ["qa-cheap", 200],
    ["qa-exhausted", 402], ["qa-worked", 200], ["qa-worked", 402],
  ])
  proof.health = await Bun.file(join(projectState, "model-policy-health.json")).json()
  const availability = await client.rpc.call({ rpcID: "momo.native", method: "catalogSnapshot", input: {}, location: project })
  const unavailable = (availability.output as { snapshot: { unavailableModels: Record<string, { reason: string }> } }).snapshot.unavailableModels
  assert.equal(unavailable[`qa-free/${id}`]?.reason, "observed_free_quota_limit")
  assert.equal(unavailable[`qa-paid/${id}`]?.reason, "observed_provider_payment_required")

  const requestsBeforeRestart = calls.length
  await qa.stop()
  client = await qa.start()
  for (const [root, saved] of completed) {
    const tasks = await tasksFor(root)
    assert.equal(tasks.length, 1)
    assert.equal(tasks[0]?.sessionID, saved.sessionID)
    assert.equal(tasks[0]?.attempts, saved.attempts)
    assert.equal(tasks[0]?.state, saved.state)
  }
  assert.equal(calls.length, requestsBeforeRestart)
  proof.restart = { priorTasks: completed.size, additionalWorkerRequests: calls.length - requestsBeforeRestart }
} catch (error) {
  proof.error = error instanceof Error ? error.stack : String(error)
  throw error
} finally {
  provider.stop(true)
  proof.cleanup = await qa.cleanup()
  await save(join(evidence, "receipt.json"), proof)
  await rm(build, { recursive: true, force: true })
}
