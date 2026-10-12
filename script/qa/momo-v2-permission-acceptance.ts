#!/usr/bin/env bun
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { execFileSync, spawn } from "node:child_process"
import { tmpdir } from "node:os"
import path from "node:path"
import { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"

const root = await mkdtemp(path.join(tmpdir(), "momo-v2-permission-"))
const evidence = path.resolve(process.env.MOMO_PERMISSION_EVIDENCE_DIR ?? ".omo/evidence/20261012-sdk-permission")
const config = path.join(root, "config/opencode")
const marker = path.join(root, "permission-denied-marker")
const hookLog = path.join(root, "hook.jsonl")
const binary = "/opt/homebrew/Cellar/opencode-v2/2.0.24/bin/opencode"
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:API[_-]?KEY|_KEY$|_TOKEN$|_SECRET$|PASSWORD)/i.test(key)))
delete env.OPENCODE_CONFIG
delete env.OPENCODE_DB
Object.assign(env, { OPENCODE_TEST_HOME: path.join(root, "home"), OPENCODE_CONFIG_DIR: config,
  XDG_DATA_HOME: path.join(root, "data"), XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_STATE_HOME: path.join(root, "state"), XDG_CACHE_HOME: path.join(root, "cache"),
  OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1" })
function realCounts() {
  const home = process.env.HOME ?? ""
  const db = [path.join(home, "Library/Application Support/opencode/opencode.db"), path.join(home, ".local/share/opencode/opencode.db")].find(existsSync)
  return db ? execFileSync("sqlite3", ["-readonly", db, "select count(*) from session; select count(*) from session_message;"], { encoding: "utf8" }).trim() : undefined
}
const before = realCounts()
let service: ReturnType<typeof spawn> | undefined
let serverOutput = ""
let calls = 0
let summary: Record<string, unknown> = { status: "failed" }
const fake = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const body = await request.json() as { stream?: boolean; messages?: Array<{ role?: string }> }
  calls += 1
  const tool = body.messages?.at(-1)?.role === "user"
  const message = tool ? { role: "assistant", tool_calls: [{ id: "fixture-shell", type: "function", function: { name: "shell", arguments: JSON.stringify({ command: "printf denied > permission-denied-marker", timeout: 10000 }) } }] } : { role: "assistant", content: "Permission fixture finished." }
  const finish = tool ? "tool_calls" : "stop"
  if (!body.stream) return Response.json({ id: "fixture", object: "chat.completion", created: 1, model: "fixture", choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
  const delta = tool ? { tool_calls: [{ index: 0, ...message.tool_calls?.[0] }] } : { content: message.content }
  const chunk = (value: unknown, reason: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: value, finish_reason: reason }] })}\n\n`
  return new Response(chunk(delta, null) + chunk({}, finish) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
} })
try {
  for (const directory of [config, path.join(config, "agents"), path.join(root, "data/opencode"), path.join(root, "home"), evidence]) await mkdir(directory, { recursive: true })
  const plugin = path.join(root, "qa-plugin")
  await mkdir(plugin)
  await writeFile(path.join(plugin, "package.json"), JSON.stringify({ name: "momo-permission-fixture", type: "module", exports: { ".": "./index.ts" } }))
  const source = path.resolve("packages/omo-opencode/src/v2")
  await writeFile(path.join(plugin, "index.ts"), [
    `import { registerPermissionHooks } from ${JSON.stringify(path.join(source, "permission-hook-bridge.ts"))}`,
    `import { createRegistrationCollector } from ${JSON.stringify(path.join(source, "registration-collector.ts"))}`,
    'import { appendFileSync } from "node:fs"',
    'export default { id: "momo-permission-fixture", async setup(ctx) {',
    `await ctx.provider.transform(editor => { editor.add({ info: { id: "momo-permission-qa", name: "Local fixture", activation: "enabled", package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: "http://127.0.0.1:${fake.port}/v1", apiKey: "local-fixture-only" } }, models: [{ id: "fixture", modelID: "fixture", providerID: "momo-permission-qa", name: "Fixture", capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 }, cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }], status: "active", enabled: true, limit: { context: 64000, output: 4096 } }] }) })`,
    'await ctx.provider.reload()',
    'const collector = createRegistrationCollector()',
    `await registerPermissionHooks(ctx, { "permission.ask": async (input, output) => { if (input.type === "shell" || input.type === "bash") { output.status = "deny"; appendFileSync(${JSON.stringify(hookLog)}, JSON.stringify({ action: input.type, status: output.status }) + "\\n") } } }, collector)`,
    'return () => collector.disposeAll()',
    '}}',
  ].join("\n"))
  await writeFile(path.join(config, "agents/permission-worker.md"), '---\nmode: all\npermission:\n  "*": allow\n---\nExecute the requested shell command once.\n')
  await writeFile(path.join(root, "data/opencode/auth.json"), JSON.stringify({ "momo-permission-qa": { type: "api", key: "local-fixture-only" } }))
  await writeFile(path.join(config, "opencode.json"), JSON.stringify({ plugins: [`file:${plugin}`], model: "momo-permission-qa/fixture", agent: "permission-worker" }))
  const portProbe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
  const port = portProbe.port
  portProbe.stop(true)
  const password = crypto.randomUUID()
  await writeFile(path.join(config, "service.json"), JSON.stringify({ password }), { mode: 0o600 })
  service = spawn(binary, ["serve", "--service", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: root, env: { ...env, OPENCODE_SERVER_PASSWORD: password }, detached: true, stdio: ["ignore", "pipe", "pipe"] })
  service.stdout?.on("data", chunk => { serverOutput += String(chunk) })
  service.stderr?.on("data", chunk => { serverOutput += String(chunk) })
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${port}`, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` } })
  const deadline = Date.now() + 30000
  let ready = false
  while (Date.now() < deadline) {
    try {
      const plugins = await client.plugin.list({ location: { directory: root } })
      if (plugins.data.some(row => row.id === "momo-permission-fixture" && row.state.status === "active")) { ready = true; break }
    } catch (error) { if (Date.now() >= deadline) throw error }
    await Bun.sleep(100)
  }
  if (!ready) throw new Error("Isolated permission plugin did not become active")
  const session = await client.session.create({ location: { directory: root }, agent: "permission-worker", model: { providerID: "momo-permission-qa", id: "fixture" } })
  await client.session.prompt({ sessionID: session.id, text: "Run the fixture shell command once." })
  await client.session.wait({ sessionID: session.id })
  const events = (await readFile(hookLog, "utf8")).trim().split("\n").map(line => JSON.parse(line) as Record<string, unknown>)
  if (!events.some(event => event.status === "deny") || existsSync(marker) || calls < 2) throw new Error("Permission bridge did not prevent the real native shell write")
  summary = { status: "passed", opencodeVersion: execFileSync(binary, ["--version"], { env, encoding: "utf8" }).trim(), nativeShellAttempted: true, bridgeHookStatus: "deny", deniedCommandDidNotWrite: true, providerCalls: calls, temporaryRootsOnly: true, noProviderCredentials: true }
} catch (error) {
  summary.error = error instanceof Error ? error.message : String(error)
  process.exitCode = 1
} finally {
  fake.stop(true)
  if (service?.pid !== undefined && service.exitCode === null && service.signalCode === null) process.kill(-service.pid, "SIGTERM")
  const end = Date.now() + 5000
  while (service && service.exitCode === null && service.signalCode === null && Date.now() < end) await Bun.sleep(100)
  summary.ownedServerExited = !service || service.exitCode !== null || service.signalCode !== null
  summary.realUserDatabaseUnchanged = before === realCounts()
  if (!summary.ownedServerExited || !summary.realUserDatabaseUnchanged) process.exitCode = 1
  await mkdir(evidence, { recursive: true })
  await writeFile(path.join(evidence, "summary.json"), JSON.stringify(summary, null, 2) + "\n")
  await writeFile(path.join(evidence, "service.log"), serverOutput)
  await rm(root, { recursive: true, force: true })
  console.log(JSON.stringify(summary))
}
