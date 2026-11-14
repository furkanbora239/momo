#!/usr/bin/env bun
// MODIFIED: prove project MCP controls on a real, isolated native service.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { readNativeMcpRegistry, nativeMcpRegistryPath } from "../../packages/omo-opencode/src/native-mcp/registry"
import { harness, until } from "./momo-native-job-classification-harness"
import { contractFixture, contractResponse, type ContractRequest } from "./momo-native-tool-contract-fixture"

const binary = process.env.MOMO_NATIVE_OPENCODE_BIN
assert(binary, "Set MOMO_NATIVE_OPENCODE_BIN")
const evidence = process.env.MOMO_NATIVE_EVIDENCE_DIR ?? join(process.cwd(), ".omo/evidence/20261114-project-mcps/native")
await mkdir(evidence, { recursive: true })
const qa = await harness(binary, evidence, { allowConcurrentMessageWrites: true })
qa.env.MOMO_QA_NATIVE_ENV_SOURCE = "qa_native_env"
const trace = join(qa.root, "mcp.jsonl")
await writeFile(trace, "")
const result: Record<string, unknown> = { proof: "real native service, local controlled models and MCP fixture", credentialsCopied: false }
const policies = await Promise.all(["orchestrator", "worker"].map(async role => ({ role, body: (await readFile(join(process.cwd(), `packages/omo-opencode/assets/native-agents/momo-${role}.md`), "utf8")).split("<!-- momo-native-agent-owned:v1 -->")[1]!.trim() })))
const observed = new Set<string>()
const codes: Record<string, string> = {
  ACTIVATE: "return JSON.parse(await tools.momo_mcp({action:'activate',server:'appwrite'}));",
  ECHO: "return await tools.appwrite.echo({value:'DRAIN_PROOF',delayMs:2000});",
  FORGED: "return await tools.momo_mcp({action:'activate',server:'appwrite',directory:'/forged'});",
  LOCKED: "return await tools.momo_mcp({action:'activate',server:'locked'});",
  DENIED: "return await tools.momo_mcp({action:'activate',server:'appwrite'});",
}
const server = Bun.serve({ port: 0, async fetch(request) {
  if (request.method === "GET") return Response.json({ data: [{ id: "root" }] })
  const body = await request.json() as ContractRequest
  const system = body.messages.filter(message => message.role === "system" || message.role === "developer").map(message => typeof message.content === "string" ? message.content : JSON.stringify(message.content)).join("\n")
  for (const policy of policies) if (system.includes(policy.body)) observed.add(policy.role)
  if (!body.tools?.some(tool => tool.function?.name === "execute")) return contractResponse(body.model, { text: "WARMUP" })
  const lastUser = body.messages.findLastIndex(message => message.role === "user")
  const text = JSON.stringify(body.messages[lastUser])
  const marker = Object.keys(codes).find(key => text.includes("MCP_QA_" + key))
  if (!marker) return contractResponse(body.model, { text: "WARMUP" })
  const tools = body.messages.slice(lastUser + 1).filter(message => message.role === "tool")
  if (tools.length === 0) return contractResponse(body.model, { code: marker === "ECHO" ? "return search({namespace:'appwrite',limit:10});" : codes[marker]! })
  if (marker === "ECHO" && tools.length === 1) return contractResponse(body.model, { code: codes.ECHO! })
  return contractResponse(body.model, { text: "MCP_QA_DONE" })
} })
try {
  await writeFile(join(qa.plugin, "package.json"), JSON.stringify({ name: "mcp-policy-qa", type: "module", exports: { ".": "./index.js" } }))
  await writeFile(join(qa.plugin, "index.js"), contractFixture(join(process.cwd(), "dist/index.js"), `http://127.0.0.1:${server.port}`).replace("await ctx.provider.reload();return momo.setup(ctx)", "return momo.setup(ctx)"))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "service.json"), JSON.stringify({ password: "local-qa" }))
  const command = (label: string) => ({ type: "local", command: ["node", join(process.cwd(), "script/qa/momo-native-mcp-fixture.mjs"), trace, label], environment: { MOMO_QA_NATIVE_ENV: "{env:MOMO_QA_NATIVE_ENV_SOURCE}" } })
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "opencode.json"), JSON.stringify({ plugins: [`file:${qa.plugin}`], model: "contract/root", agent: "momo-orchestrator", mcp: { servers: { appwrite: command("appwrite"), codegraph: command("codegraph"), momo_lsp: { ...command("native_disabled"), disabled: true }, locked: { ...command("locked"), disabled: true } } } }))
  await writeFile(join(qa.project, ".omo/omo.jsonc"), '{\n// preserved project settings\n"[opencode]":{"catalog":{"auto_research":false}}\n}\n')
  const second = join(qa.root, "second")
  await mkdir(join(second, ".omo"), { recursive: true })
  await writeFile(join(second, ".omo/omo.jsonc"), JSON.stringify({ "[opencode]": { catalog: { auto_research: false }, mcp_policy: { appwrite: "off" } } }))
  const cliOutput = execFileSync("node", [join(process.cwd(), "dist/cli-node/index.js"), "mcp-manage", "--config", join(qa.env.OPENCODE_CONFIG_DIR!, "opencode.json")], { cwd: qa.project, env: qa.env, encoding: "utf8", timeout: 30000 })
  await writeFile(join(evidence, "cli-adoption.log"), cliOutput)
  result.adopted = Object.keys(await readNativeMcpRegistry(nativeMcpRegistryPath(qa.env.HOME!, qa.env.OPENCODE_CONFIG_DIR!)))
  let client = await qa.start()
  result.version = (await client.server.info()).version
  async function snapshot(directory = qa.project) {
    await until(async () => (await client.plugin.list({ location: { directory } })).data, rows => rows.some(row => row.id === "oh-my-openagent" && row.state.status === "active"), "scoped native plugin activation")
    const response = await client.rpc.call({ rpcID: "momo.mcp", method: "snapshot", input: {}, location: { directory } })
    return response.output as { servers: { server: string; mode: string; requested: boolean; draining: boolean; status: { status: string } }[] }
  }
  async function mode(value: string) { return client.rpc.call({ rpcID: "momo.mcp", method: "setMode", input: { server: "appwrite", mode: value }, location: { directory: qa.project } }) }
  async function run(marker: string, agent = "momo-orchestrator") {
    const session = await client.session.create({ location: { directory: qa.project }, agent, model: { providerID: "contract", id: "root" } })
    await client.session.prompt({ sessionID: session.id, text: "MCP_QA_" + marker })
    return session
  }
  const initial = await snapshot()
  assert.equal(initial.servers.find(row => row.server === "appwrite")?.mode, "on-demand")
  assert(!initial.servers.find(row => row.server === "appwrite")?.requested)
  assert(!initial.servers.find(row => row.server === "codegraph")?.requested)
  assert(!initial.servers.find(row => row.server === "locked")?.requested)
  assert(!initial.servers.find(row => row.server === "momo_lsp")?.requested, "Native search overrode an explicit disable")
  assert.equal(await readFile(trace, "utf8"), "", "External MCP started without demand")
  result.coldExternalDormant = true
  const advisor = await run("ACTIVATE", "momo-advisor")
  await client.session.wait({ sessionID: advisor.id })
  assert(!(await snapshot()).servers.find(row => row.server === "appwrite")?.requested, "Advisor activated an external connector")
  result.advisorControlReadOnly = true
  const activation = await run("ACTIVATE")
  await client.session.wait({ sessionID: activation.id })
  await writeFile(join(evidence, "activation-context.json"), JSON.stringify(await client.session.context({ sessionID: activation.id }), null, 2))
  await until(snapshot, state => state.servers.some(row => row.server === "appwrite" && row.status.status === "connected"), "Appwrite connection")
  const other = await snapshot(second)
  assert.equal(other.servers.find(row => row.server === "appwrite")?.mode, "off")
  assert(!other.servers.find(row => row.server === "appwrite")?.requested)
  result.projectIsolation = true
  const readonly = await run("ECHO")
  await client.session.wait({ sessionID: readonly.id })
  const deniedContext = JSON.stringify(await client.session.context({ sessionID: readonly.id }))
  assert(deniedContext.includes("tools.appwrite.echo"), "Coordinator did not attempt the protected operation")
  assert(!(await readFile(trace,"utf8")).includes('"event":"entered"'), "Activation expanded coordinator tool permissions")
  result.coordinatorExternalCallDenied = true
  const echo = await run("ECHO", "momo-worker")
  await until(async () => readFile(trace, "utf8"), text => text.includes('"event":"entered"'), "real MCP operation admission")
  await mode("off")
  const draining = await snapshot()
  assert(draining.servers.find(row => row.server === "appwrite")?.draining, "Disable did not retain the active operation")
  await client.session.wait({ sessionID: echo.id })
  const context = JSON.stringify(await client.session.context({ sessionID: echo.id }))
  assert(context.includes("MCP_ECHO:DRAIN_PROOF"), "In-flight operation was lost")
  await until(snapshot, state => state.servers.some(row => row.server === "appwrite" && row.status.status === "disabled"), "MCP disconnect after draining")
  result.inFlightDrain = true
  const denied = await run("DENIED")
  await client.session.wait({ sessionID: denied.id })
  assert(JSON.stringify(await client.session.context({ sessionID: denied.id })).includes("disabled"))
  const locked = await run("LOCKED")
  await client.session.wait({ sessionID: locked.id })
  assert(!(await snapshot()).servers.find(row => row.server === "locked")?.requested)
  await mode("on-demand")
  const forged = await run("FORGED")
  await client.session.wait({ sessionID: forged.id })
  assert(!(await snapshot()).servers.find(row => row.server === "appwrite")?.requested)
  await mode("off")
  const persisted = await readFile(join(qa.project, ".omo/omo.jsonc"), "utf8")
  assert(persisted.includes("// preserved project settings") && persisted.includes('"off"'))
  await qa.stop(); client = await qa.start()
  assert.equal((await snapshot()).servers.find(row => row.server === "appwrite")?.mode, "off")
  result.offSurvivesRestart = true
  await mode("always")
  await qa.stop(); client = await qa.start()
  await until(snapshot, state => state.servers.some(row => row.server === "appwrite" && row.status.status === "connected"), "always reconnect after restart")
  result.alwaysSurvivesRestart = true
  await mode("on-demand")
  const lease = await run("ACTIVATE")
  await client.session.wait({ sessionID: lease.id })
  await qa.stop(); client = await qa.start()
  const dormant = (await snapshot()).servers.find(row => row.server === "appwrite")
  assert.equal(dormant?.mode, "on-demand")
  assert.equal(dormant?.requested, false)
  result.restartDropsTransientLeases = true
  const rows = (await readFile(trace, "utf8")).trim().split("\n").map(line => JSON.parse(line) as { label: string; nativeEnvironmentResolved: boolean })
  assert(rows.every(row => row.label === "appwrite" && row.nativeEnvironmentResolved), "Managed MCP did not preserve native environment interpolation")
  result.nativeEnvironmentInterpolation = true
  result.trace = rows
  assert(observed.has("orchestrator") && observed.has("worker"), "Current MCP role policies did not reach the model")
  result.observedRolePolicies = [...observed]
  result.passed = true
} finally {
  server.stop(true)
  result.cleanup = await qa.cleanup()
  await writeFile(join(evidence, "result.json"), JSON.stringify(result, null, 2))
}
console.log(JSON.stringify(result, null, 2))
