#!/usr/bin/env bun
// MODIFIED: real native execution with controlled catalog/research HTTP fixtures, no real provider calls.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { harness, until } from "./momo-native-job-classification-harness"
import type { JevRequest } from "./momo-native-job-classification-fixture"
import { classificationReply, researchResponse, sharedCatalogFixture, researchedSummary, type FixtureModel } from "./momo-native-shared-catalog-fixture"

if (process.argv.includes("--self-test")) {
  const body = { state: JSON.stringify({ models: [{ model: { providerID: "qa-new", id: "unresearched-v1" }, evidence: [{ facts: { summary: researchedSummary } }] }] }), questions: { m0c0: { criteria: { suitable: "yes", unsuitable: "no" } } } }
  assert.equal(classificationReply(body).answers.m0c0?.choice, "suitable")
  assert.throws(() => classificationReply({ ...body, state: body.state.replace("qa-new", "qa-disabled") }))
  new Bun.Transpiler({ loader: "js" }).transformSync(sharedCatalogFixture("/built/index.js", "http://127.0.0.1:1234", "/isolated/models.json"))
  const response = researchResponse({ model: "mimo-v2.6-flash-free", messages: [], tools: [{ function: { name: "momo_catalog_enrich" } }] })
  assert((await response.text()).includes("momo_catalog_enrich"))
  console.log("Shared catalog QA fixtures passed; no server or native process started")
  process.exit(0)
}
const binary = process.env.MOMO_NATIVE_OPENCODE_BIN
assert(binary && isAbsolute(binary) && existsSync(binary), "Set absolute MOMO_NATIVE_OPENCODE_BIN to real native executable")
const evidence = process.env.MOMO_NATIVE_EVIDENCE_DIR ?? join(process.cwd(), ".omo/evidence/20261020-shared-model-catalog/native")
await mkdir(evidence, { recursive: true })
const entry = join(process.cwd(), "dist/index.js")
assert(existsSync(entry), "Build the current native plugin first")
const qa = await harness(binary, evidence, { allowConcurrentMessageWrites: true })
const modelFile = join(qa.root, "models.json"), requests: JevRequest[] = [], executions: Record<string, unknown>[] = []
const models: FixtureModel[] = [
  { providerID: "qa-known", id: "mimo-v2.6-flash-free", price: 1 },
  { providerID: "qa-free", id: "mimo-v2.6-flash-free", price: 0 },
  { providerID: "qa-new", id: "unresearched-v1", price: 1 },
  { providerID: "qa-disabled", id: "unknown-disabled-v1", price: 1 },
]
let mockError: string | undefined
const server = Bun.serve({ port: 0, async fetch(request) {
  try {
    const path = new URL(request.url).pathname
    if (path.endsWith("/models")) return Response.json({ data: models.filter(row => path.includes(`/${row.providerID}/`)).map(row => ({ id: row.id })) })
    const body = await request.json() as Record<string, unknown>
    if (path.startsWith("/qa-manager/")) {
      const payload = body as unknown as JevRequest
      requests.push(structuredClone(payload))
      return Response.json(classificationReply(payload))
    }
    assert(path === "/qa-free/v1/chat/completions", "Research used an unexpected or paid executor: " + path)
    executions.push({ path, body })
    return researchResponse(body as Parameters<typeof researchResponse>[0])
  } catch (error) { mockError = String(error); return Response.json({ error: mockError }, { status: 500 }) }
} })
const projectRoot = join(qa.env.HOME!, ".omo/native/projects", createHash("sha256").update(qa.project).digest("hex").slice(0, 24))
const knowledgePath = join(qa.env.HOME!, ".omo/native/catalog-knowledge.json")
const maintenancePath = join(projectRoot, "catalog-maintenance.json")
const result: Record<string, unknown> = { status: "running", proof: "real native runtime with controlled HTTP fixtures", realProviderProof: false, credentialsCopied: false }
async function sourceHashes() {
  const paths = ["dist/index.js", "packages/omo-opencode/assets/model-catalog.json", "script/qa/momo-native-shared-catalog.ts", "script/qa/momo-native-shared-catalog-fixture.ts"]
  for (const dir of ["native-catalog", "native-runtime", "native-routing"]) {
    for await (const file of new Bun.Glob("**/*.ts").scan(join(process.cwd(), "packages/omo-opencode/src", dir))) {
      if (!file.endsWith(".test.ts")) paths.push(`packages/omo-opencode/src/${dir}/${file}`)
    }
  }
  return Object.fromEntries(await Promise.all(paths.sort().map(async path => [path, createHash("sha256").update(await readFile(path)).digest("hex") ])))
}
async function readJSON(path: string): Promise<Record<string, unknown> | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error }
}
try {
  result.sourceHashesBefore = await sourceHashes()
  result.bundleSHA256 = createHash("sha256").update(await readFile(entry)).digest("hex")
  await writeFile(modelFile, JSON.stringify(models))
  const fixture = sharedCatalogFixture(entry, `http://127.0.0.1:${server.port}`, modelFile)
  await writeFile(join(qa.plugin, "package.json"), JSON.stringify({ name: "momo-shared-catalog-native-qa", type: "module", exports: { ".": "./index.js" } }))
  await writeFile(join(qa.plugin, "index.js"), fixture)
  await writeFile(join(evidence, "fixture.js"), fixture)
  await writeFile(join(qa.env.HOME!, ".omo/provider-toggles.json"), JSON.stringify({ version: 1, disabled: ["qa-disabled"], updatedAt: new Date().toISOString() }))
  await writeFile(join(qa.project, ".omo/omo.jsonc"), JSON.stringify({ "[opencode]": {
    catalog: { job_classes: [{ id: "coding", description: "Implement software" }, { id: "research", description: "Find sources" }] },
    manager: { jev: { provider_id: "qa-manager", base_url: `http://127.0.0.1:${server.port}/qa-manager/v1`, max_attempts: 1 } },
  } }))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "opencode.json"), JSON.stringify({ plugins: [`file:${qa.plugin}`], model: "qa-known/mimo-v2.6-flash-free", agent: "momo-orchestrator" }))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "service.json"), JSON.stringify({ password: "local-qa" }))
  let client = await qa.start()
  result.version = (await client.server.info()).version
  const completed = await until(async () => await readJSON(maintenancePath), data => {
    const entries = data?.entries as { model: { providerID: string }; status: string }[] | undefined
    return entries?.some(row => row.model.providerID === "qa-new" && row.status === "completed") === true
  }, "automatic startup research without any user prompt", 45000)
  const entries = completed!.entries as { model: { providerID: string; id: string }; context: { rootSessionID: string }; status: string; executor?: { providerID: string } }[]
  assert.equal(entries.length, 1, "Known or disabled models were researched")
  assert.equal(entries[0]!.executor?.providerID, "qa-free", "Verified free executor was not selected")
  const knowledge = await readJSON(knowledgePath)
  assert.equal((knowledge?.entries as Record<string, { summary: string }>)?.["qa-new/unresearched-v1"]?.summary, researchedSummary)
  await until(async () => requests, rows => rows.some(row => row.state.includes(researchedSummary)), "classification sees persisted research", 30000)
  const newModelClassifications = requests.filter(row => row.state.includes('"providerID":"qa-new"'))
  assert(newModelClassifications.length > 0 && newModelClassifications.every(row => row.state.includes(researchedSummary)), "Unknown model classified before research")
  const initialRoot = entries[0]!.context.rootSessionID
  async function assertSingleRoot() {
    const sessions = (await client.session.list({ directory: qa.project, limit: 100 })).data
    const roots = sessions.filter(session => session.metadata?.momoCatalogMaintenance === true)
    assert.equal(roots.length, 1, "Expected exactly one persisted headless maintenance root")
    assert.equal(roots[0]!.id, initialRoot)
    assert.equal(roots[0]!.parentID, undefined)
  }
  await assertSingleRoot()
  const executionCount = executions.length, initialCalls = requests.length
  assert(executionCount >= 2, "Actual native tool enrichment and completion did not run")
  await qa.capture()
  await qa.stop()
  client = await qa.start()
  await Bun.sleep(2000)
  assert.equal(executions.length, executionCount, "Restart repeated research")
  assert.equal(requests.length, initialCalls, "Restart reclassified unchanged catalog")
  const restarted = await readJSON(maintenancePath)
  assert.deepEqual(restarted, completed, "Restart duplicated or changed completed research")
  await assertSingleRoot()
  await qa.stop()
  models.push({ providerID: "qa-added", id: "mimo-v2.6-flash-free", price: 1 })
  await writeFile(modelFile, JSON.stringify(models))
  client = await qa.start()
  await until(async () => requests, rows => rows.some(row => row.state.includes('"providerID":"qa-added"')), "new endpoint reuses bundled known card")
  assert.equal(executions.length, executionCount, "New endpoint researched a known model")
  assert.deepEqual(await readJSON(maintenancePath), completed, "New endpoint created another research root/task")
  await assertSingleRoot()
  assert.equal(mockError, undefined)
  result.sourceHashesAfter = await sourceHashes()
  assert.deepEqual(result.sourceHashesAfter, result.sourceHashesBefore, "Source or bundle changed during QA")
  result.startupWithoutPrompt = true; result.maintenanceRoot = initialRoot; result.maintenanceEntries = entries
  result.restartRepeatedResearch = false; result.newEndpointRepeatedResearch = false; result.status = "passed"
} catch (error) { result.status = "failed"; result.error = String(error) }
finally {
  try {
    for (const file of await readdir(projectRoot)) if (/\.(json|jsonl)$/.test(file)) await writeFile(join(evidence, file), await readFile(join(projectRoot, file)))
    if (existsSync(knowledgePath)) await writeFile(join(evidence, "catalog-knowledge.json"), await readFile(knowledgePath))
    await writeFile(join(evidence, "session-messages.json"), execFileSync("sqlite3", ["-readonly", "-json", join(qa.env.XDG_DATA_HOME!, "opencode/opencode.db"), "select session_id,type,data from session_message order by time_created"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }))
  } catch (error) { result.artifactError = String(error) }
  try { result.cleanup = await qa.cleanup() } catch (error) { result.cleanupError = String(error); result.status = "failed" }
  server.stop(true)
  await writeFile(join(evidence, "requests.json"), JSON.stringify({ requests, executions }, null, 2))
  await writeFile(join(evidence, "receipt.json"), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result))
  if (result.status !== "passed") process.exitCode = 1
}
