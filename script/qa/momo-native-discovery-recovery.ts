#!/usr/bin/env bun
// MODIFIED: isolated real OpenCode proof of optional discovery and bounded refresh.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, isAbsolute } from "node:path"
import { harness, until } from "./momo-native-job-classification-harness"
import { contractResponse, type ContractRequest } from "./momo-native-tool-contract-fixture"
import type { JevRequest } from "./momo-native-job-classification-fixture"
import { sharedCatalogFixture } from "./momo-native-shared-catalog-fixture"

const binary = process.env.MOMO_NATIVE_OPENCODE_BIN
assert(binary && isAbsolute(binary), "Set absolute MOMO_NATIVE_OPENCODE_BIN")
const evidence = process.env.MOMO_NATIVE_EVIDENCE_DIR ?? join(process.cwd(), ".omo/evidence/20261024-catalog-recovery/native")
const qa = await harness(binary, evidence, { allowConcurrentMessageWrites: true })
const entry = join(process.cwd(), "dist/index.js")
const modelFile = join(qa.root, "models.json")
const statuses = { "qa-404": 404, "qa-405": 405, "qa-empty": 200, "qa-auth": 401 }
const calls: Record<string, number> = {}
let rootCreated = false, childRequests = 0
const server = Bun.serve({ port: 0, async fetch(request) {
  const path = new URL(request.url).pathname
  if (path.endsWith("/systemone")) {
    const body = await request.json() as JevRequest
    return Response.json({ answers: Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
      const keys = Object.keys(question.criteria)
      const choice = key === "jobClass" ? "coding" : key === "role" ? "worker" : key === "candidate" ? keys.find(value => value.startsWith("worker|qa-404/")) : key === "lane" ? "direct" : keys.includes("suitable") ? "suitable" : keys[0]
      assert(choice && keys.includes(choice), `Invalid QA choice ${key}`)
      return [key, { type: "choice", choice, confidence: 1, probabilities: { [choice]: 1 } }]
    })), usage: { input_tokens: 17, output_tokens: 11 } })
  }
  if (request.method === "POST") {
    const body = await request.json() as ContractRequest
    const text = JSON.stringify(body.messages)
    if (text.includes("DISCOVERY_ROOT") && !rootCreated && body.tools?.some(tool => tool.function?.name === "execute")) {
      rootCreated = true
      return contractResponse(body.model, { code: `return await tools.momo_task({action:"create",prompt:"DISCOVERY_CHILD: reply CHILD_EXECUTED",scope:"Return the requested marker.",acceptance:"Return CHILD_EXECUTED",view:"brief"})` })
    }
    if (text.includes("DISCOVERY_CHILD") && !text.includes("DISCOVERY_ROOT")) { childRequests++; return contractResponse(body.model, { text: "CHILD_EXECUTED" }) }
    return contractResponse(body.model, { text: "ROOT_READY" })
  }
  const provider = new URL(request.url).pathname.split("/")[1]!
  calls[provider] = (calls[provider] ?? 0) + 1
  const status = statuses[provider as keyof typeof statuses]
  assert(status, "Unexpected external fixture request")
  return status === 200 ? Response.json({ data: [] }) : new Response(null, { status })
} })
const paths = ["dist/index.js", "packages/omo-opencode/src/native-catalog/live-models.ts", "packages/omo-opencode/src/native-catalog/adapter.ts", "packages/omo-opencode/src/native-catalog/provider-admission.ts", "script/qa/momo-native-discovery-recovery.ts"]
const hashes = async () => Object.fromEntries(await Promise.all(paths.map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex")])))
const receipt: Record<string, unknown> = { status: "running", proof: "real OpenCode HTTP catalog RPC with local discovery fixtures", realProviderProof: false }
try {
  receipt.sourceHashesBefore = await hashes()
  await writeFile(modelFile, JSON.stringify(Object.keys(statuses).map(providerID => ({ providerID, id: "mimo-v2.6-flash-free", price: 1 }))))
  await writeFile(join(qa.plugin, "package.json"), JSON.stringify({ name: "momo-discovery-recovery-qa", type: "module", exports: { ".": "./index.js" } }))
  await writeFile(join(qa.plugin, "index.js"), sharedCatalogFixture(entry, `http://127.0.0.1:${server.port}`, modelFile))
  await writeFile(join(qa.project, ".omo/omo.jsonc"), JSON.stringify({ "[opencode]": { catalog: { auto_research: false }, manager: { jev: { provider_id: "qa-404", base_url: `http://127.0.0.1:${server.port}/jev/v1`, model: "manager", max_attempts: 1 } } } }))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "opencode.json"), JSON.stringify({ plugins: [`file:${qa.plugin}`], model: "qa-404/mimo-v2.6-flash-free", agent: "momo-orchestrator" }))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "service.json"), JSON.stringify({ password: "local-qa" }))
  const healthDirectory = join(qa.env.HOME!, ".omo/native-cache")
  await mkdir(healthDirectory, { recursive: true })
  await writeFile(join(healthDirectory, "provider-health.json"), JSON.stringify({ "qa-404": { reason: "live model endpoint returned HTTP 404", statusCode: 404, unavailableUntil: Date.now() + 120000 } }))
  const client = await qa.start()
  receipt.version = (await client.server.info()).version
  async function snapshot() {
    const result = await client.rpc.call({ rpcID: "momo.native", method: "catalogSnapshot", input: {}, location: { directory: qa.project } }) as { output?: unknown }
    return (result.output ?? result) as { snapshot: { models: { providerID: string }[]; unavailableProviders: Record<string, unknown> } }
  }
  const initial = (await snapshot()).snapshot
  assert.deepEqual(initial.models.map(row => row.providerID).sort(), ["qa-404", "qa-405"])
  assert.equal(initial.unavailableProviders["qa-404"], undefined)
  assert.equal(initial.unavailableProviders["qa-405"], undefined)
  assert(initial.unavailableProviders["qa-auth"])
  receipt.initialSnapshot = initial
  receipt.persistedUnsupportedDiscoveryRecovered = true
  const initialCalls = { ...calls }
  for (let index = 0; index < 5; index++) await snapshot()
  assert.deepEqual(calls, initialCalls, "Repeated snapshots bypassed discovery cache")
  receipt.cachedSnapshotReads = 5
  const toggles = join(qa.env.HOME!, ".omo/provider-toggles.json")
  await writeFile(toggles, JSON.stringify({ version: 1, disabled: ["qa-404"], updatedAt: new Date().toISOString() }))
  assert.deepEqual((await snapshot()).snapshot.models.map(row => row.providerID), ["qa-405"])
  await writeFile(toggles, JSON.stringify({ version: 1, disabled: [], updatedAt: new Date().toISOString() }))
  assert.deepEqual((await snapshot()).snapshot.models.map(row => row.providerID).sort(), ["qa-404", "qa-405"])
  assert.deepEqual(calls, initialCalls)
  receipt.toggleAppliedInsideCacheWindow = true
  await Bun.sleep(30_100)
  await snapshot()
  assert.equal(calls["qa-404"], initialCalls["qa-404"]! + 1)
  assert.equal(calls["qa-405"], initialCalls["qa-405"]! + 1)
  assert.equal(calls["qa-empty"], initialCalls["qa-empty"]! + 1)
  receipt.expiryRefreshedDiscovery = true
  const root = await client.session.create({ location: { directory: qa.project }, agent: "momo-orchestrator", model: { providerID: "qa-404", id: "mimo-v2.6-flash-free" } })
  await client.session.prompt({ sessionID: root.id, text: "DISCOVERY_ROOT" })
  await client.session.wait({ sessionID: root.id })
  const tasks = await until(async () => {
    const response = await client.rpc.call({ rpcID: "momo.native", method: "tasks", input: { rootSessionID: root.id }, location: { directory: qa.project } })
    return (((response as { output?: unknown }).output ?? response) as { tasks: { state: string; model?: { providerID: string }; sessionID?: string }[] }).tasks
  }, rows => rows.some(row => row.state === "succeeded"), "child execution", 60000)
  assert(childRequests > 0, "No actual child inference request")
  assert(tasks.some(row => row.state === "succeeded" && row.model?.providerID === "qa-404"), JSON.stringify(tasks))
  receipt.childExecution = { childRequests, tasks }
  receipt.sourceHashesAfter = await hashes()
  assert.deepEqual(receipt.sourceHashesAfter, receipt.sourceHashesBefore)
  receipt.status = "passed"
} catch (error) { receipt.status = "failed"; receipt.error = String(error) }
finally {
  try { receipt.cleanup = await qa.cleanup() } catch (error) { receipt.status = "failed"; receipt.cleanupError = String(error) }
  server.stop(true)
  receipt.discoveryCalls = calls
  await writeFile(join(evidence, "receipt.json"), JSON.stringify(receipt, null, 2))
  console.log(JSON.stringify(receipt))
  if (receipt.status !== "passed") process.exitCode = 1
}
