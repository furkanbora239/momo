#!/usr/bin/env bun
// MODIFIED: exercise the published archive in a disposable consumer and native HOME.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { mkdir, readFile, stat, writeFile, symlink } from "node:fs/promises"
import { delimiter, join } from "node:path"
import { harness, until } from "./momo-native-job-classification-harness"
import { contractFixture, contractResponse, type ContractRequest } from "./momo-native-tool-contract-fixture"

const binary = process.env.MOMO_NATIVE_OPENCODE_BIN
assert(binary, "Set MOMO_NATIVE_OPENCODE_BIN to the real native executable")
const evidence = process.env.MOMO_NATIVE_EVIDENCE_DIR ?? join(process.cwd(), ".omo/evidence/20261114-native-search-install/native")
await mkdir(evidence, { recursive: true })
const qa = await harness(binary, evidence, { allowConcurrentMessageWrites: true })
const tools = join(qa.root, "tools")
await mkdir(tools)
for (const command of ["bun", "node"]) {
  const executable = Bun.which(command)
  assert(executable, `Missing QA executable: ${command}`)
  await symlink(executable, join(tools, command))
}
qa.env.PATH = [tools, "/usr/bin", "/bin"].join(delimiter)
const receipt: Record<string, unknown> = { proof: "published archive, real native harness, controlled local model", credentialsCopied: false }
const server = Bun.serve({ port: 0, async fetch(request) {
  if (request.method === "GET") return Response.json({ data: [{ id: "root" }] })
  const body = await request.json() as ContractRequest
  if (!JSON.stringify(body.messages).includes("SEARCH_INSTALL_PROBE") || !body.tools?.some(tool => tool.function?.name === "execute")) return contractResponse(body.model, { text: "WARMUP" })
  const lastUser = body.messages.findLastIndex(message => message.role === "user")
  const turnTools = body.messages.slice(lastUser + 1).filter(message => message.role === "tool")
  if (turnTools.length === 0) return contractResponse(body.model, { code: "return {lsp:search({namespace:'momo_lsp',limit:20}),ast:search({namespace:'momo_ast_grep',limit:10})};" })
  if (!JSON.stringify(turnTools).includes("SEARCH_INSTALL_OK")) return contractResponse(body.model, { code: "const status=await tools.momo_lsp.status();const definition=await tools.momo_lsp.goto_definition({filePath:'definition.ts',line:2,character:13});const matches=await tools.momo_ast_grep.search({pattern:'console.log($A)',language:'typescript',paths:['fixture.ts']});return {proof:'SEARCH_INSTALL_OK',status,definition,matches};" })
  return contractResponse(body.model, { text: "DONE" })
} })
try {
  const archive = join(qa.root, "momo.tgz")
  const pack = execFileSync("bun", ["pm", "pack", "--ignore-scripts", "--filename", archive], { cwd: process.cwd(), encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })
  await writeFile(join(evidence, "pack.log"), pack)
  const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).split("\n")
  for (const file of ["packages/lsp-tools-mcp/dist/cli.js", "packages/ast-grep-mcp/dist/cli.js"]) assert(entries.includes("package/" + file), "Archive missing " + file)
  receipt.archiveSHA256 = createHash("sha256").update(await readFile(archive)).digest("hex")
  const consumer = join(qa.root, "consumer")
  await mkdir(consumer)
  await writeFile(join(consumer, "package.json"), JSON.stringify({ name: "isolated-momo-consumer", private: true }))
  const install = execFileSync("bun", ["add", "--ignore-scripts", archive, "typescript-language-server@5.0.0", "typescript@5.9.3"], { cwd: consumer, env: qa.env, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, timeout: 120_000 })
  await writeFile(join(evidence, "consumer-install.log"), install)
  const metadata = JSON.parse(await readFile(join(process.cwd(), "package.json"), "utf8")) as { name: string }
  const installed = join(consumer, "node_modules", metadata.name)
  assert(!existsSync(join(installed, "packages/ast-grep-mcp/src")), "Consumer unexpectedly has source files")
  const runtime = join(qa.env.HOME!, ".omo/runtime/ast-grep")
  assert(!existsSync(runtime), "Not a cold runtime HOME")
  await writeFile(join(qa.plugin, "package.json"), JSON.stringify({ name: "search-install-qa", type: "module", exports: { ".": "./index.js" } }))
  await writeFile(join(qa.plugin, "index.js"), contractFixture(join(installed, "dist/index.js"), `http://127.0.0.1:${server.port}`))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "service.json"), JSON.stringify({ password: "local-qa" }))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "opencode.json"), JSON.stringify({ plugins: [`file:${qa.plugin}`], model: "contract/root", agent: "momo-orchestrator" }))
  await writeFile(join(qa.project, ".omo/omo.jsonc"), JSON.stringify({ "[opencode]": { catalog: { auto_research: false } } }))
  const lspConfig = join(qa.env.HOME!, ".omo/native/lsp.json")
  await mkdir(join(qa.env.HOME!, ".omo/native"), { recursive: true })
  await writeFile(lspConfig, JSON.stringify({ lsp: { typescript: { command: [join(consumer, "node_modules/.bin/typescript-language-server"), "--stdio"], extensions: [".ts"] } } }))
  await writeFile(join(qa.project, "definition.ts"), "export const answer = 42;\nconsole.log(answer);\n")
  let client = await qa.start()
  receipt.version = (await client.server.info()).version
  receipt.servers = await until(async () => (await client.mcp.list({ location: { directory: qa.project } })).data, rows => rows.length === 2 && rows.every(row => row.status.status === "connected"), "bundled MCP connections")
  assert(!existsSync(runtime), "MCP discovery unexpectedly downloaded ast-grep")
  let session = await client.session.create({ location: { directory: qa.project }, agent: "momo-orchestrator", model: { providerID: "contract", id: "root" } })
  async function probe(marker: string) {
    await writeFile(join(qa.project, "fixture.ts"), `console.log("${marker}");\n`)
    await client.session.prompt({ sessionID: session.id, text: "SEARCH_INSTALL_PROBE " + marker })
    await client.session.wait({ sessionID: session.id })
    const context = await client.session.context({ sessionID: session.id })
    await writeFile(join(evidence, marker + ".json"), JSON.stringify(context, null, 2))
    const tools = context.flatMap(message => "content" in message ? message.content.filter(part => part.type === "tool") : [])
    const envelope = JSON.parse(JSON.stringify(tools.at(-1))) as { state: { content: { type: string; text?: string }[] } }
    const text = envelope.state.content.filter(part => part.type === "text").map(part => part.text ?? "").join("\n")
    const result = JSON.parse(text) as { proof: string; definition: string; matches: { ok: boolean; matches: { text: string }[] } }
    assert.equal(result.proof, "SEARCH_INSTALL_OK")
    assert.equal(result.matches.ok, true)
    assert.equal(result.matches.matches.length, 1)
    assert(result.matches.matches[0]!.text.includes(marker), "Search did not reflect the fixture")
    assert.equal(result.definition, join(qa.project, "definition.ts") + ":1:0", "LSP did not navigate to the declaration")
  }
  await probe("COLD_MATCH")
  assert(existsSync(runtime), "First actual tool use did not create managed runtime")
  receipt.runtimeProvisionedOnFirstUse = true
  await probe("UPDATED_MATCH")
  receipt.sourceFreshness = true
  const executable = join(runtime, `${process.platform}-${process.arch}`, process.platform === "win32" ? "sg.exe" : "sg")
  const beforeRestart = (await stat(executable)).mtimeMs
  await qa.stop()
  client = await qa.start()
  await until(async () => (await client.mcp.list({ location: { directory: qa.project } })).data, rows => rows.length === 2 && rows.every(row => row.status.status === "connected"), "MCP reconnect after restart")
  session = await client.session.create({ location: { directory: qa.project }, agent: "momo-orchestrator", model: { providerID: "contract", id: "root" } })
  await probe("RESTART_MATCH")
  assert.equal((await stat(executable)).mtimeMs, beforeRestart, "Restart downloaded the runtime again")
  receipt.restartReusedRuntime = true
  receipt.passed = true
} finally {
  server.stop(true)
  receipt.cleanup = await qa.cleanup()
  await writeFile(join(evidence, "result.json"), JSON.stringify(receipt, null, 2))
}
console.log(JSON.stringify(receipt, null, 2))
