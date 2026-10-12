import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

const binary = resolve(process.argv[2] ?? "")
if (!process.argv[2]) throw new Error("usage: bun qa-mcp-release.mjs /absolute/path/to/codebase-memory-mcp")
const root = await mkdtemp(join(tmpdir(), "momo-native-search-mcp-qa-"))
const fixture = join(root, "fixture")
const cache = join(root, "cache")
const config = join(root, "config")
const runtime = join(root, "runtime")
await Promise.all([fixture, cache, config, runtime].map((path) => mkdir(path, { recursive: true, mode: 0o700 })))
const isolatedEnv = {
  ...process.env,
  CBM_CACHE_DIR: cache,
  CBM_RUNTIME_DIR: runtime,
  CBM_ALLOWED_ROOT: fixture,
  XDG_CONFIG_HOME: config,
}
let child
let nextId = 0
const pending = new Map()

function start() {
  child = spawn(binary, ["serve", "--mcp"], { env: isolatedEnv, stdio: ["pipe", "pipe", "pipe"] })
  const lines = createInterface({ input: child.stdout })
  lines.on("line", (line) => {
    let message
    try { message = JSON.parse(line) } catch (error) { process.stderr.write(`ignored non-JSON MCP stdout: ${String(error)}\n`); return }
    const waiter = pending.get(message.id)
    if (waiter) { pending.delete(message.id); waiter.resolve(message) }
  })
  child.stderr.on("data", (chunk) => process.stderr.write(chunk))
}

function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`)
}

function request(method, params = {}) {
  const id = ++nextId
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => { pending.delete(id); rejectPromise(new Error(`MCP request timed out: ${method}`)) }, 60_000)
    pending.set(id, { resolve: (value) => { clearTimeout(timer); resolvePromise(value) }, reject: rejectPromise })
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
  })
}

async function connect() {
  start()
  const hello = await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "momo-native-search-qa", version: "1" } })
  if (hello.error || hello.result?.serverInfo?.version !== "0.11.0") throw new Error(`unexpected MCP initialize response: ${JSON.stringify(hello)}`)
  notify("notifications/initialized")
  return hello.result
}

async function call(name, args) {
  const response = await request("tools/call", { name, arguments: args })
  if (response.error || response.result?.isError) throw new Error(`${name} failed: ${JSON.stringify(response)}`)
  return response.result?.structuredContent ?? response.result?.content?.[0]?.text ?? response.result
}

try {
  const info = await connect()
  const listed = await request("tools/list")
  const tools = listed.result?.tools ?? []
  const requiredTools = ["index_repository", "search_graph", "trace_path", "check_index_coverage", "list_projects"]
  const toolNames = tools.map((tool) => tool.name)
  if (requiredTools.some((name) => !toolNames.includes(name))) throw new Error(`MCP contract missing tools: ${requiredTools.filter((name) => !toolNames.includes(name))}`)
  for (const toolName of requiredTools) {
    const tool = tools.find((candidate) => candidate.name === toolName)
    if (!tool?.inputSchema || tool.inputSchema.type !== "object" || !tool.inputSchema.properties) throw new Error(`invalid input schema for ${toolName}`)
  }
  await writeFile(join(fixture, "fixture.ts"), "export function alpha() { return beta() }\nexport function beta() { return 42 }\n")
  const { execFileSync } = await import("node:child_process")
  execFileSync("git", ["init", fixture], { stdio: "ignore" })
  const indexed = await call("index_repository", { repo_path: fixture, mode: "full" })
  const project = indexed.project
  const symbol = await call("search_graph", { project, label: "Function", name_pattern: ".*alpha.*", format: "json" })
  if (!JSON.stringify(symbol).includes("alpha")) throw new Error(`symbol search failed: ${JSON.stringify(symbol)}`)
  const references = await call("trace_path", { project, function_name: "alpha", direction: "outbound", depth: 2, format: "json" })
  if (!JSON.stringify(references).includes("beta")) throw new Error(`reference traversal failed: ${JSON.stringify(references)}`)
  const coverage = await call("check_index_coverage", { project, paths: ["fixture.ts"], format: "json" })
  if (!JSON.stringify(coverage).includes("metadata_match")) throw new Error(`freshness check failed: ${JSON.stringify(coverage)}`)
  const parallel = await Promise.all(Array.from({ length: 4 }, () => call("search_graph", { project, label: "Function", name_pattern: ".*beta.*", format: "json" })))
  if (parallel.some((result) => !JSON.stringify(result).includes("beta"))) throw new Error("parallel MCP searches failed")
  await writeFile(join(fixture, "fixture.ts"), "export function alpha() { return gamma() }\nexport function gamma() { return 43 }\n")
  let changedSymbol
  const freshnessDeadline = Date.now() + 20_000
  do {
    changedSymbol = await call("search_graph", { project, label: "Function", name_pattern: ".*gamma.*", format: "json" })
    if (JSON.stringify(changedSymbol).includes("gamma")) break
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
  } while (Date.now() < freshnessDeadline)
  const automaticFreshness = JSON.stringify(changedSymbol).includes("gamma")
  const reindexed = automaticFreshness ? undefined : await call("index_repository", { repo_path: fixture, mode: "full" })
  changedSymbol = await call("search_graph", { project, label: "Function", name_pattern: ".*gamma.*", format: "json" })
  if (!JSON.stringify(changedSymbol).includes("gamma") || (reindexed && reindexed.status !== "indexed")) throw new Error("freshness after source edit failed")
  child.stdin.end()
  await new Promise((resolvePromise) => child.once("exit", resolvePromise))
  const reconnectInfo = await connect()
  const projects = await call("list_projects", {})
  if (!JSON.stringify(projects).includes(project)) throw new Error("MCP reconnect did not recover indexed project")
  process.stdout.write(JSON.stringify({ version: info.serverInfo.version, tools: toolNames, project, indexed, symbol, references, coverage, parallelSearches: parallel.length, automaticFreshness, reindexed, changedSymbol, reconnect: reconnectInfo.serverInfo.version }, null, 2) + "\n")
} finally {
  if (child && child.exitCode === null) child.kill("SIGTERM")
  await rm(root, { recursive: true, force: true })
}
