#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import net from "node:net"

const root = await mkdtemp(path.join(tmpdir(), "momo-native-qa-v2-"))
const evidenceDir = process.env.MOMO_NATIVE_QA_EVIDENCE_DIR ?? path.join(process.cwd(), ".omo", "evidence", "20261011-v2-baseline")
const qaHomeDir = path.join(root, "opencode-test-home")
const dirs = {
  data: path.join(root, "xdg-data"),
  config: path.join(root, "xdg-config"),
  state: path.join(root, "xdg-state"),
  cache: path.join(root, "xdg-cache"),
}
const opencodeConfigDir = path.join(dirs.config, "opencode")
for (const dir of Object.values(dirs)) await mkdir(dir, { recursive: true })
await mkdir(qaHomeDir, { recursive: true })
let server
let fakeModel
let serverOutput = ""
let fakeModelOutput = ""
let report
let userDbBefore

function readUserDbCounts() {
  const candidates = [
    process.env.OPENCODE_DB,
    process.env.XDG_DATA_HOME ? path.join(process.env.XDG_DATA_HOME, "opencode", "opencode.db") : undefined,
    path.join(process.env.HOME ?? "", ".local", "share", "opencode", "opencode.db"),
    path.join(process.env.HOME ?? "", "Library", "Application Support", "opencode", "opencode.db"),
  ].filter((value) => typeof value === "string" && value.length > 0)
  const dbPath = candidates.find((candidate) => candidate && requireExists(candidate))
  if (!dbPath) throw new Error("could not locate real OpenCode SQLite DB for the read-only before/after check")
  const sql = "SELECT 'session', count(*) FROM session UNION ALL SELECT 'session_message', count(*) FROM session_message;"
  const rows = execFileSync("sqlite3", ["-readonly", dbPath, sql], { encoding: "utf8" }).trim().split("\n")
  return { dbPath, counts: Object.fromEntries(rows.map((row) => row.split("|"))) }
}

function requireExists(filePath) {
  return path.isAbsolute(filePath) && existsSync(filePath)
}

function isolatedEnv(extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:API[_-]?KEY|_KEY$|_TOKEN$|_SECRET$|PASSWORD)/i.test(key)))
  delete env.OPENCODE_DB
  delete env.OPENCODE_CONFIG
  return {
    ...env,
    OPENCODE_TEST_HOME: qaHomeDir,
    OPENCODE_CONFIG_DIR: opencodeConfigDir,
    XDG_DATA_HOME: dirs.data,
    XDG_CONFIG_HOME: dirs.config,
    XDG_STATE_HOME: dirs.state,
    XDG_CACHE_HOME: dirs.cache,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    NO_COLOR: "1",
    ...extra,
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer()
    listener.once("error", reject)
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address()
      if (!address || typeof address === "string") return reject(new Error("could not allocate port"))
      listener.close(() => resolve(address.port))
    })
  })
}

async function startChild(script, env, onOutput) {
  const port = await freePort()
  const child = spawn("node", [script], {
    env: { ...isolatedEnv(), ...env, MOMO_NATIVE_QA_FAKE_MODEL_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let output = ""
  child.stdout.on("data", (chunk) => { output += chunk.toString(); onOutput(chunk.toString()) })
  child.stderr.on("data", (chunk) => { output += chunk.toString(); onOutput(chunk.toString()) })
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline && !output.includes(`127.0.0.1:${port}`)) {
    if (child.exitCode !== null) throw new Error(`local fixture exited early (${child.exitCode}): ${output}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (!output.includes(`127.0.0.1:${port}`)) throw new Error(`local fixture did not report its port: ${output}`)
  return { child, port }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return child?.exitCode ?? null
  child.kill("SIGTERM")
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 3_000))])
  if (child.exitCode === null) {
    child.kill("SIGKILL")
    await new Promise((resolve) => child.once("exit", resolve))
  }
  return child.exitCode
}

async function waitForJsonSessionList(url, headers, locationQuery = "") {
  const deadline = Date.now() + 20_000
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/session${locationQuery}`, { headers })
      if (!response.ok) throw new Error(`GET /api/session returned HTTP ${response.status}`)
      const payload = await response.json()
      if (!Array.isArray(payload.data)) throw new Error("GET /api/session was not a V2 JSON data envelope")
      return payload
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  throw new Error(`v2 API did not become ready: ${lastError}`)
}

async function proveEventStream(url, locationQuery, headers) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(`${url}/api/event${locationQuery}`, { headers, signal: controller.signal })
    if (!response.ok || !response.body) throw new Error(`GET /api/event returned HTTP ${response.status}`)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const frame = buffer.split("\n\n")[0]
      const data = frame.split("\n").find((line) => line.startsWith("data: "))?.slice(6)
      if (!data) continue
      const event = JSON.parse(data)
      if (event.type === "server.connected") return event.type
    }
    throw new Error("/api/event ended before server.connected")
  } finally {
    clearTimeout(timeout)
    controller.abort()
  }
}

async function main() {
  userDbBefore = readUserDbCounts()
  const env = isolatedEnv()
  const version = execFileSync("opencode", ["--version"], { env, cwd: root, encoding: "utf8" }).trim()
  const fakeScript = path.join(root, "fake-model-script.json")
  const permissionEvents = path.join(root, "permission-events.jsonl")
  const deniedMarker = path.join(root, "denied-shell-ran")
  const fixtureScript = [
    { match: "MOMO_PERMISSION_DENY_PROBE", lastRole: "user", once: true, tool_calls: [{ name: "shell", arguments: { command: `touch ${deniedMarker}`, description: "momo permission QA denial probe" } }] },
    { lastRole: "tool", text: "MOMO_PERMISSION_DENIED_CONFIRMED" },
  ]
  await writeFile(fakeScript, `${JSON.stringify(fixtureScript, null, 2)}\n`, { mode: 0o600 })
  const fakeModelResult = await startChild(path.join(process.cwd(), "script/qa/momo-native-qa-fake-model.mjs"), {
    MOMO_NATIVE_QA_SCRIPT: fakeScript,
    MOMO_NATIVE_QA_LOG: path.join(root, "fake-model-requests.jsonl"),
  }, (chunk) => { fakeModelOutput += chunk })
  fakeModel = fakeModelResult.child
  const port = await freePort()
  const url = `http://127.0.0.1:${port}`
  const password = `qa-${crypto.randomUUID()}`
  const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  const headers = { authorization: auth, "content-type": "application/json" }
  await mkdir(opencodeConfigDir, { recursive: true })
  await writeFile(path.join(opencodeConfigDir, "service.json"), `${JSON.stringify({ password })}\n`, { mode: 0o600 })
  const pluginDir = path.join(root, ".opencode", "plugins")
  await mkdir(pluginDir, { recursive: true })
  const probePluginPath = path.join(pluginDir, "momo-permission-probe.ts")
  await writeFile(probePluginPath, [
    'import { appendFileSync } from "node:fs"',
    'export default { id: "momo-permission-probe", async setup(ctx) {',
    '  appendFileSync(process.env.MOMO_QA_PERMISSION_LOG, `${JSON.stringify({ type: "setup", providerIds: ctx.provider ? "available" : "missing" })}\\n`)',
    '  await ctx.provider.transform((editor) => {',
    '    const info = { id: "momo-qa", name: "Momo QA local", activation: "enabled", package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: process.env.MOMO_QA_MODEL_URL, apiKey: "momo-qa-local-fixture" } }',
    '    const model = { id: "momo-qa-model", modelID: "momo-qa-model", providerID: "momo-qa", name: "momo-qa-model", capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 }, cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }], status: "active", enabled: true, limit: { context: 8192, output: 2048 } }',
    '    if (editor.get("momo-qa")) editor.update("momo-qa", (provider) => { provider.activation = "enabled"; provider.settings = info.settings })',
    '    else editor.add({ info, models: [model] })',
    '  })',
    '  await ctx.provider.reload()',
    '  await ctx.permission.hook("evaluate", (event) => {',
    '    if (event.action !== "shell") return',
    '    const before = event.effect',
    '    event.effect = "deny"',
    '    appendFileSync(process.env.MOMO_QA_PERMISSION_LOG, `${JSON.stringify({ action: event.action, before, after: event.effect, sessionID: event.sessionID })}\\n`)',
    '  })',
  '}}',
  ].join("\n"), { mode: 0o600 })
  await writeFile(path.join(opencodeConfigDir, "opencode.json"), `${JSON.stringify({
    "$schema": "https://opencode.ai/config.json",
    plugins: [probePluginPath],
    model: "momo-qa/momo-qa-model",
    providers: {},
  }, null, 2)}\n`, { mode: 0o600 })
  await mkdir(path.join(dirs.data, "opencode"), { recursive: true })
  await writeFile(path.join(dirs.data, "opencode", "auth.json"), `${JSON.stringify({ "momo-qa": { type: "api", key: "momo-qa-local-fixture" } })}\n`, { mode: 0o600 })
  server = spawn("opencode", ["serve", "--service", "--hostname", "127.0.0.1", "--port", String(port)], {
    env: isolatedEnv({ MOMO_QA_PERMISSION_LOG: permissionEvents, MOMO_QA_MODEL_URL: `http://127.0.0.1:${fakeModelResult.port}/v1` }),
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
  })
  server.stdout.on("data", (chunk) => { serverOutput += chunk.toString() })
  server.stderr.on("data", (chunk) => { serverOutput += chunk.toString() })

  const locationQuery = `?location%5Bdirectory%5D=${encodeURIComponent(root)}`
  await waitForJsonSessionList(url, headers, locationQuery)
  const createResponse = await fetch(`${url}/api/session`, { method: "POST", headers, body: JSON.stringify({ location: { directory: root } }) })
  const created = await createResponse.json()
  if (!createResponse.ok || typeof created.data?.id !== "string") throw new Error("POST /api/session did not return data.id")
  const providerResponse = await fetch(`${url}/api/provider${locationQuery}`, { headers })
  const providers = await providerResponse.json()
  if (!providerResponse.ok || !Array.isArray(providers.data)) throw new Error(`GET /api/provider returned HTTP ${providerResponse.status} with ${JSON.stringify(providers)}`)
  if (!providers.data.some((provider) => provider.id === "momo-qa")) {
    const models = await fetch(`${url}/api/model${locationQuery}`, { headers }).then((response) => response.json())
    const config = await fetch(`${url}/api/config${locationQuery}`, { headers }).then((response) => response.json())
    const pluginResponse = await fetch(`${url}/api/plugin${locationQuery}`, { headers })
    const plugins = await pluginResponse.json()
    const pluginLines = existsSync(permissionEvents) ? readFileSync(permissionEvents, "utf8").trim() : "<no setup log>"
    const ids = (models.data ?? []).map((model) => `${model.providerID}/${model.modelID}`)
    throw new Error(`local fake provider was not active in V2 (providers=${JSON.stringify(providers.data.map((provider) => provider.id))}; models=${JSON.stringify(ids)}; config=${JSON.stringify(config)}; pluginStatus=${pluginResponse.status}; plugins=${JSON.stringify(plugins)}; setupLog=${pluginLines})`)
  }
  const modelResponse = await fetch(`${url}/api/model${locationQuery}`, { headers })
  const modelPayload = await modelResponse.json()
  if (!modelResponse.ok || !Array.isArray(modelPayload.data) || modelPayload.data.length !== 1 || modelPayload.data[0].providerID !== "momo-qa") {
    throw new Error(`isolated model catalog contains unexpected providers (${JSON.stringify((modelPayload.data ?? []).map((model) => model.providerID))})`)
  }
  const sessionList = await waitForJsonSessionList(url, headers, locationQuery)
  if (!sessionList.data.some((item) => item.id === created.data.id)) throw new Error("new session missing from GET /api/session")
  const streamEvent = await proveEventStream(url, locationQuery, headers)
  const promptResponse = await fetch(`${url}/api/session/${encodeURIComponent(created.data.id)}/prompt${locationQuery}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text: "MOMO_PERMISSION_DENY_PROBE" }),
  })
  if (!promptResponse.ok) throw new Error(`POST /api/session/:id/prompt returned HTTP ${promptResponse.status}`)
  if (!existsSync(permissionEvents)) throw new Error("real server never evaluated the permission hook")
  const permissionRows = readFileSync(permissionEvents, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  if (!permissionRows.some((event) => event.action === "shell" && event.after === "deny")) throw new Error("permission hook did not change the real shell evaluation to deny")
  if (existsSync(deniedMarker)) throw new Error("shell command ran even though permission hook denied it")
  const fakeRequests = readFileSync(path.join(root, "fake-model-requests.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line))
  if (!fakeRequests.some((entry) => entry.model === "momo-qa-model" && entry.request.tools?.some((tool) => (tool.function?.name ?? tool.name) === "shell"))) {
    throw new Error("fake model did not receive the model selection and shell tool schema")
  }

  report = {
    opencodeVersion: version,
    apiRoutes: ["GET /api/session", "POST /api/session", "GET /api/provider"],
    eventStreamRoute: "/api/event",
    observedEvent: streamEvent,
    createdSessionId: created.data.id,
    providerCount: providers.data.length,
    activeModels: modelPayload.data.map((model) => `${model.providerID}/${model.modelID}`),
    fakeModelRequests: fakeRequests,
    permissionEvaluations: permissionRows,
    deniedCommandMarkerCreated: existsSync(deniedMarker),
    isolatedHome: path.relative(root, qaHomeDir),
    isolatedXdg: Object.fromEntries(Object.entries(dirs).map(([key, value]) => [key, path.relative(root, value)])),
    evidence: "real installed OpenCode v2 server + fake local provider + isolated permission plugin",
  }
}

try {
  await main()
} catch (error) {
  process.stderr.write(`FAIL: ${error instanceof Error ? error.message : String(error)}\n`)
  if (serverOutput) process.stderr.write(serverOutput.replaceAll(/password[^\n]*/gi, "password [redacted]").slice(-3000))
  process.exitCode = 1
} finally {
  const serverExitCode = await stopChild(server)
  const fakeModelExitCode = await stopChild(fakeModel)
  const cleanup = { serverExitCode, fakeModelExitCode, sandboxRootRemoved: true }
  await rm(root, { recursive: true, force: true })
  const userDbAfter = userDbBefore ? readUserDbCounts() : undefined
  const userDatabaseUnchanged = userDbBefore !== undefined
    && userDbAfter !== undefined
    && JSON.stringify(userDbBefore.counts) === JSON.stringify(userDbAfter.counts)
  if (!userDatabaseUnchanged) process.exitCode = 1
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(path.join(evidenceDir, "cleanup.json"), `${JSON.stringify({
    ...cleanup,
    userDatabaseUnchanged,
    tablesBefore: userDbBefore?.counts,
    tablesAfter: userDbAfter?.counts,
  }, null, 2)}\n`, { mode: 0o600 })
  if (report) {
    report.serverExitCode = cleanup.serverExitCode
    report.sandboxRootRemoved = cleanup.sandboxRootRemoved
    report.userDatabaseUnchanged = userDatabaseUnchanged
    await writeFile(path.join(evidenceDir, "v2-server-smoke.json"), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  }
}
