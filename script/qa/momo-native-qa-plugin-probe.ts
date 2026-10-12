import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { spawn, execFileSync } from "node:child_process"
import { createServer } from "node:net"
import { createServer as createHttpServer } from "node:http"
import { tmpdir } from "node:os"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"

const root = await mkdtemp(path.join(tmpdir(), "momo-native-plugin-probe-"))
const evidenceDir = process.env.MOMO_NATIVE_QA_EVIDENCE_DIR ?? path.join(process.cwd(), ".omo/evidence/20261011-native-engine/plugin-probe")
const qaHome = path.join(root, "home")
const xdg = {
  data: path.join(root, "xdg-data"),
  config: path.join(root, "xdg-config"),
  state: path.join(root, "xdg-state"),
  cache: path.join(root, "xdg-cache"),
}
const configDir = path.join(xdg.config, "opencode")
const pluginDir = path.join(root, ".opencode", "plugins")
const setupLog = path.join(root, "plugin-setup.jsonl")
const modelLog = path.join(root, "model-requests.jsonl")
const callLog = path.join(root, "fake-tool-calls.jsonl")
const jevLog = path.join(root, "jev-requests.jsonl")
const deniedMarker = path.join(root, "denied-shell-ran")
const deniedEditFile = path.join(root, "denied-edit.txt")
let opencode: ReturnType<typeof spawn> | undefined
let modelServer: ReturnType<typeof createHttpServer> | undefined
let opencodeOutput = ""
let modelPort = 0
let serverPort = 0
let dbBefore: Record<string, string> | undefined
let outcome: Record<string, unknown> | undefined
let stage = "startup"

function isolatedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:API[_-]?KEY|_KEY$|_TOKEN$|_SECRET$|PASSWORD)/i.test(key)))
  return {
    ...clean,
    OPENCODE_TEST_HOME: qaHome,
    OPENCODE_CONFIG_DIR: configDir,
    XDG_DATA_HOME: xdg.data,
    XDG_CONFIG_HOME: xdg.config,
    XDG_STATE_HOME: xdg.state,
    XDG_CACHE_HOME: xdg.cache,
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    NO_COLOR: "1",
    ...extra,
  }
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const socket = createServer()
    socket.once("error", reject)
    socket.listen(0, "127.0.0.1", () => {
      const address = socket.address()
      if (address === null || typeof address === "string") return reject(new Error("failed to reserve loopback port"))
      socket.close(() => resolve(address.port))
    })
  })
}

function realDatabaseCounts(): Record<string, string> | undefined {
  const realHome = process.env.HOME
  if (!realHome) return undefined
  const candidates = [
    path.join(realHome, "Library/Application Support/opencode/opencode.db"),
    path.join(realHome, ".local/share/opencode/opencode.db"),
  ]
  for (const dbPath of candidates) {
    if (!existsSync(dbPath)) continue
    try {
      const rows = execFileSync("sqlite3", ["-readonly", dbPath, "select 'session',count(*) from session union all select 'session_message',count(*) from session_message;"], { encoding: "utf8" }).trim().split("\n")
      return Object.fromEntries(rows.map((row) => row.split("|")))
    } catch (error) {
      if (!(error instanceof Error)) throw error
    }
  }
  throw new Error("could not read the real OpenCode database for a before/after safety check")
}

function json(response: import("node:http").ServerResponse, value: unknown): void {
  response.writeHead(200, { "content-type": "application/json" })
  response.end(JSON.stringify(value))
}

async function startFakeModel(): Promise<void> {
  modelServer = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (request.method === "POST" && url.pathname.endsWith("/systemone")) {
      let raw = ""
      for await (const chunk of request) raw += chunk.toString()
      const body = JSON.parse(raw) as { state?: string; questions?: { candidate?: { criteria?: Record<string, string> }; lane?: { criteria?: Record<string, string> } } }
      await appendFile(jevLog, `${JSON.stringify(body)}\n`, { mode: 0o600 })
      const candidates = Object.keys(body.questions?.candidate?.criteria ?? {})
      const manualSelection = typeof body.state === "string" && (JSON.parse(body.state) as { input?: { prompt?: string } }).input?.prompt === "MOMO_MANUAL_SELECTION_PROBE"
      const workerCandidates = candidates.filter((key) => key.startsWith("worker|momo-qa/")).sort()
      const candidate = manualSelection
        ? candidates.find((key) => key.startsWith("planner|momo-qa/"))
        : workerCandidates.find((key) => key.endsWith("/momo-qa-model")) ?? candidates.find((key) => key.startsWith("catalog-researcher|momo-qa/"))
      if (!candidate) {
        response.writeHead(422, { "content-type": "application/json" })
        response.end(JSON.stringify({ error: "fixture found no worker candidate" }))
        return
      }
      const probabilities = manualSelection
        ? Object.fromEntries(candidates.map((key) => [key, key.startsWith("planner|") ? 0.4 : key.startsWith("executor|") ? 0.3 : key.startsWith("reviewer|") ? 0.2 : key.startsWith("worker|") ? 0.1 : 0]))
        : { [candidate]: 1 }
      json(response, { answers: {
        candidate: { type: "choice", choice: candidate, confidence: manualSelection ? 0.4 : 0.99, probabilities },
        lane: { type: "choice", choice: manualSelection ? "department" : "direct", confidence: 0.99, probabilities: { direct: manualSelection ? 0 : 1, department: manualSelection ? 1 : 0 } },
      }, usage: { input_tokens: 1, output_tokens: 1 } })
      return
    }
    if (request.method === "GET" && url.pathname.endsWith("/models")) {
      json(response, { data: [{ id: "momo-qa-model", object: "model", created: 0, owned_by: "momo-qa" }] })
      return
    }
    if (request.method !== "POST") {
      response.writeHead(404).end()
      return
    }
    let raw = ""
    for await (const chunk of request) raw += chunk.toString()
    const body = JSON.parse(raw) as { model?: string; stream?: boolean; messages?: Array<{ role?: string; content?: unknown }>; tools?: Array<{ function?: { name?: string } }> }
    await appendFile(modelLog, `${JSON.stringify(body)}\n`, { mode: 0o600 })
    const lastMessage = body.messages?.at(-1)
    const lastRole = lastMessage?.role
    const lastUserText = [...(body.messages ?? [])].reverse().find((message) => message.role === "user")?.content
    const userText = typeof lastUserText === "string" ? lastUserText : JSON.stringify(lastUserText ?? "")
    const toolNames = (body.tools ?? []).flatMap((tool) => typeof tool.function?.name === "string" ? [tool.function.name] : [])
    const systemText = body.messages?.find((message) => message.role === "system")?.content
    const systemPrompt = typeof systemText === "string" ? systemText : JSON.stringify(systemText ?? "")
    const requestManualSelection = userText.includes("MOMO_TASK_MANUAL_SELECTION_PROBE") && toolNames.includes("execute") && systemPrompt.includes("tools.momo_task(")
    const requestTask = userText.includes("MOMO_TASK_PROBE") && toolNames.includes("execute") && systemPrompt.includes("tools.momo_task(")
    const requestPermission = userText.includes("MOMO_PERMISSION_DENY_PROBE") && toolNames.includes("execute")
    const requestShellPermission = userText.includes("MOMO_PERMISSION_SHELL_PROBE") && toolNames.includes("execute")
    const requestEditPermission = userText.includes("MOMO_PERMISSION_EDIT_PROBE") && toolNames.includes("execute")
    const requestCatalogEnrich = userText.includes("MOMO_CATALOG_ENRICH_DENY_PROBE")
    const requestCatalogResearch = userText.includes("MOMO_CATALOG_ENRICH_ALLOW_PROBE") && toolNames.includes("momo_catalog_enrich")
    const toolReply = lastRole === "tool"
    if (body.stream) {
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" })
      const contentDelta = toolReply
        ? { content: requestTask ? "MOMO_TASK_TOOL_CONFIRMED" : requestShellPermission ? "MOMO_SHELL_PERMISSION_CONFIRMED" : requestEditPermission ? "MOMO_EDIT_PERMISSION_CONFIRMED" : requestCatalogEnrich ? "MOMO_CATALOG_ENRICH_DENIED_CONFIRMED" : "MOMO_PERMISSION_DENIED_CONFIRMED" }
        : !requestTask && !requestManualSelection && !requestPermission && !requestShellPermission && !requestEditPermission && !requestCatalogEnrich && !requestCatalogResearch ? { content: "Momo local QA session" } : undefined
      const toolName = requestCatalogEnrich || requestCatalogResearch ? "momo_catalog_enrich" : requestShellPermission ? "shell" : requestEditPermission ? "edit" : "execute"
      const args = requestManualSelection
        ? { code: 'const created = JSON.parse(await tools.momo_task({action:"create",prompt:"MOMO_MANUAL_SELECTION_PROBE"})); const denied = JSON.parse(await tools.momo_task({action:"select",taskID:created.id,decisionId:created.decisionId,role:"worker",providerID:"momo-qa",modelID:"momo-qa-model"})); const selected = JSON.parse(await tools.momo_task({action:"select",taskID:created.id,decisionId:created.decisionId,role:"planner",providerID:"momo-qa",modelID:"momo-qa-model"})); return {created,denied,selected}' }
        : requestTask
        ? { code: 'return await tools.momo_task({action:"create",prompt:"MOMO_CHILD_PROBE"})' }
        : requestShellPermission
          ? { command: `touch ${deniedMarker}`, description: "permission QA" }
          : requestEditPermission
            ? { path: deniedEditFile, oldString: "unchanged", newString: "modified" }
            : requestCatalogEnrich || requestCatalogResearch
              ? { providerID: "momo-qa", id: "momo-qa-model", summary: "unauthorized profile", sources: ["https://attacker.example/model"] }
          : { code: `return await import("node:fs").then((fs) => fs.writeFileSync(${JSON.stringify(deniedMarker)}, "bad"))` }
      const call = { index: 0, id: requestTask ? "call_task_probe" : requestShellPermission ? "call_shell_probe" : requestEditPermission ? "call_edit_probe" : "call_denial_probe", type: "function", function: { name: toolName, arguments: JSON.stringify(args) } }
      await appendFile(callLog, `${JSON.stringify({ userText, toolName, arguments: args })}\n`, { mode: 0o600 })
      response.write(`data: ${JSON.stringify({ id: "momo-probe", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: contentDelta ?? { tool_calls: [call] }, finish_reason: null }] })}\n\n`)
      response.write(`data: ${JSON.stringify({ id: "momo-probe", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: contentDelta ? "stop" : "tool_calls" }] })}\n\n`)
      response.end("data: [DONE]\n\n")
      return
    }
    json(response, { id: "momo-probe", object: "chat.completion", created: 1, model: body.model, choices: [{ index: 0, message: { role: "assistant", content: toolReply ? requestTask ? "MOMO_TASK_TOOL_CONFIRMED" : requestShellPermission ? "MOMO_SHELL_PERMISSION_CONFIRMED" : "MOMO_PERMISSION_DENIED_CONFIRMED" : null }, finish_reason: "stop" }] })
  })
  modelPort = await new Promise<number>((resolve, reject) => {
    modelServer?.once("error", reject)
    modelServer?.listen(0, "127.0.0.1", () => {
      const address = modelServer?.address()
      if (address === null || address === undefined || typeof address === "string") return reject(new Error("fake provider did not bind"))
      resolve(address.port)
    })
  })
}

async function waitUntilReady(client: ReturnType<typeof OpenCode.make>, directory: string): Promise<void> {
  const deadline = Date.now() + 15_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      await client.server.info()
      const providers = await client.provider.list({ location: { directory } })
      if (providers.data.some((provider) => provider.id === "momo-qa")) return
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`provider was not registered before timeout: ${String(lastError)}`)
}

async function main(): Promise<void> {
  stage = "isolated-setup"
  dbBefore = realDatabaseCounts()
  for (const directory of [qaHome, ...Object.values(xdg), path.join(xdg.data, "opencode"), configDir, pluginDir]) await mkdir(directory, { recursive: true })
  await startFakeModel()
  serverPort = await freePort()
  const pluginPath = path.join(pluginDir, "momo-probe.ts")
  const entryPath = path.join(process.cwd(), "packages/omo-opencode/src/index.ts")
  await writeFile(pluginPath, [
    'import { appendFileSync } from "node:fs"',
    `import momo from ${JSON.stringify(entryPath)}`,
    'export default { id: "momo-native-probe", async setup(ctx) {',
    '  await ctx.provider.transform((editor) => {',
    '    editor.add({ info: { id: "momo-qa", name: "Momo local fake", activation: "enabled", package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: process.env.MOMO_QA_MODEL_URL, apiKey: "local-only" } }, models: [{ id: "momo-qa-model", modelID: "momo-qa-model", providerID: "momo-qa", name: "Momo QA local", capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 }, cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }], status: "active", enabled: true, limit: { context: 8192, output: 2048 } }] })',
    '  })',
    '  await ctx.provider.reload()',
    '  const setupStarted = performance.now()',
    '  const cleanup = await momo.setup(ctx)',
    '  const setupMs = performance.now() - setupStarted',
    '  appendFileSync(process.env.MOMO_QA_SETUP_LOG, `${JSON.stringify({ setup: true, setupMs })}\\n`)',
    '  await ctx.session.hook("context", (event) => { appendFileSync(process.env.MOMO_QA_SETUP_LOG, `${JSON.stringify({ contextAgent: event.agent, contextTools: Object.keys(event.tools) })}\\n`) })',
    '  await ctx.permission.hook("evaluate", (event) => {',
    '    const before = event.effect',
    '    appendFileSync(process.env.MOMO_QA_SETUP_LOG, `${JSON.stringify({ action: event.action, before, after: event.effect, sessionID: event.sessionID, resources: event.resources })}\\n`)',
    '  })',
    '  return cleanup',
    '}}',
  ].join("\n"), { mode: 0o600 })
  await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({
    "$schema": "https://opencode.ai/config.json",
    plugin: [pluginPath],
    model: "momo-qa/momo-qa-model",
    agent: "momo-orchestrator",
  }, null, 2)}\n`, { mode: 0o600 })
  await mkdir(path.join(root, ".omo"), { recursive: true })
  await mkdir(path.join(qaHome, ".omo"), { recursive: true })
  const legacyLedgerPath = path.join(qaHome, ".omo/decision-ledger.jsonl")
  const legacyLedgerLine = '{"schemaVersion":2,"id":"isolated-legacy-export"}'
  await writeFile(legacyLedgerPath, `${legacyLedgerLine}\n`, { mode: 0o600 })
  await writeFile(deniedEditFile, "unchanged", { mode: 0o600 })
  await writeFile(path.join(qaHome, ".omo", "model-pool.json"), `${JSON.stringify({ version: 1, allowed: [{ providerID: "momo-qa", modelID: "momo-qa-model", preferred: true }], updatedAt: "2026-10-12T00:00:00.000Z" }, null, 2)}\n`, { mode: 0o600 })
  await writeFile(path.join(root, ".omo", "omo.jsonc"), `${JSON.stringify({ "[opencode]": { manager: { jev: {
    provider_id: "momo-qa", base_url: `http://127.0.0.1:${modelPort}/jev/v1`, model: "jev-1.13", max_attempts: 1,
  }, advisor_models: [{ providerID: "momo-qa", id: "momo-qa-model" }] } } }, null, 2)}\n`, { mode: 0o600 })
  const servicePassword = `qa-${randomUUID()}`
  await writeFile(path.join(configDir, "service.json"), JSON.stringify({ password: servicePassword }), { mode: 0o600 })
  await writeFile(path.join(xdg.data, "opencode", "auth.json"), JSON.stringify({ "momo-qa": { type: "api", key: "local-only" } }), { mode: 0o600 })
  opencode = spawn("opencode", ["serve", "--service", "--hostname", "127.0.0.1", "--port", String(serverPort)], {
    cwd: root,
    env: isolatedEnv({ MOMO_QA_SETUP_LOG: setupLog, MOMO_QA_MODEL_URL: `http://127.0.0.1:${modelPort}/v1` }),
    stdio: ["ignore", "pipe", "pipe"],
  })
  opencode.stdout.on("data", (chunk: Buffer) => { opencodeOutput += chunk.toString() })
  opencode.stderr.on("data", (chunk: Buffer) => { opencodeOutput += chunk.toString() })
  const baseUrl = `http://127.0.0.1:${serverPort}`
  const authorization = `Basic ${Buffer.from(`opencode:${servicePassword}`).toString("base64")}`
  const client = OpenCode.make({ baseUrl, headers: { authorization } })
  await waitUntilReady(client, root)
  const plugins = await client.plugin.list({ location: { directory: root } })
  if (!plugins.data.some((plugin) => plugin.id === "momo-native-probe" && plugin.state.status === "active")) {
    const config = await client.config.get({ location: { directory: root } })
    const providers = await client.provider.list({ location: { directory: root } })
    const setupRows = await Bun.file(setupLog).text().catch(() => "<missing>")
    throw new Error(`local plugin not reported active: ${JSON.stringify({ plugins: plugins.data, config, providers: providers.data.map((provider) => provider.id), setupRows })}`)
  }
  const setupRows = (await readFile(setupLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
  if (!setupRows.some((row) => row.setup === true)) throw new Error("plugin setup marker was not written")
  const session = await client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  stage = "dynamic-import-denial"
  await client.session.prompt({ sessionID: session.id, text: "MOMO_PERMISSION_DENY_PROBE" })
  await client.session.wait({ sessionID: session.id })
  stage = "shell-permission-denial"
  const shellSession = await client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  await client.session.prompt({ sessionID: shellSession.id, text: "MOMO_PERMISSION_SHELL_PROBE" })
  try {
    await client.session.wait({ sessionID: shellSession.id })
  } catch (error) {
    opencodeOutput += `shell denial wait response: ${error instanceof Error ? error.message : String(error)}\n`
  }
  stage = "task-tool-and-routing"
  const taskSession = await client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  try {
    await client.session.prompt({ sessionID: taskSession.id, text: "MOMO_TASK_PROBE" })
  } catch (error) {
    opencodeOutput += `task prompt response: ${error instanceof Error ? error.message : String(error)}\n`
  }
  try {
    await client.session.wait({ sessionID: taskSession.id })
  } catch (error) {
    opencodeOutput += `task wait response: ${error instanceof Error ? error.message : String(error)}\n`
  }
  const finalRows = (await readFile(setupLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
  if (!finalRows.some((row) => row.setup === true)) throw new Error("integrated plugin setup marker disappeared")
  if (await Bun.file(deniedMarker).exists()) throw new Error("denied shell command created the marker")
  const editSession = await client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  await client.session.prompt({ sessionID: editSession.id, text: "MOMO_PERMISSION_EDIT_PROBE" })
  await client.session.wait({ sessionID: editSession.id })
  if (await readFile(deniedEditFile, "utf8") !== "unchanged") throw new Error("coordinator direct edit call modified the protected file")
  stage = "catalog-enrich-role-denial"
  const knowledgePath = path.join(qaHome, ".omo/native/catalog-knowledge.json")
  const knowledgeBefore = await Bun.file(knowledgePath).exists() ? await readFile(knowledgePath, "utf8") : undefined
  const enrichSession = await client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  try {
    await client.session.prompt({ sessionID: enrichSession.id, text: "MOMO_CATALOG_ENRICH_DENY_PROBE" })
    await client.session.wait({ sessionID: enrichSession.id })
  } catch (error) {
    opencodeOutput += `catalog enrich denial result: ${error instanceof Error ? error.message : String(error)}\n`
  }
  const knowledgeAfter = await Bun.file(knowledgePath).exists() ? await readFile(knowledgePath, "utf8") : undefined
  if (knowledgeAfter !== knowledgeBefore) throw new Error("coordinator catalog-enrich attempt changed the sourced knowledge store")
  stage = "catalog-researcher-enrichment"
  const researcherSession = await client.session.create({ location: { directory: root }, agent: "momo-catalog-researcher", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  await client.session.prompt({ sessionID: researcherSession.id, text: "MOMO_CATALOG_ENRICH_ALLOW_PROBE" })
  await client.session.wait({ sessionID: researcherSession.id })
  const researcherRequest = (await readFile(modelLog, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { messages?: Array<{ role?: string; content?: unknown }>; tools?: Array<{ function?: { name?: string } }> }).find((request) =>
    request.messages?.some((message) => message.role === "user" && message.content === "MOMO_CATALOG_ENRICH_ALLOW_PROBE") &&
    request.messages?.some((message) => message.role === "system" && typeof message.content === "string" && message.content.includes("You are momo's catalog researcher")))
  if (!researcherRequest?.tools?.some((tool) => tool.function?.name === "momo_catalog_enrich")) throw new Error("catalog researcher did not receive momo_catalog_enrich as a direct tool")
  const knowledgeResearched = await Bun.file(knowledgePath).exists() ? await readFile(knowledgePath, "utf8") : ""
  if (!knowledgeResearched.includes('"momo-qa/momo-qa-model"') || !knowledgeResearched.includes("https://attacker.example/model")) throw new Error("owned catalog researcher did not persist the sourced enrichment profile")
  const requests = (await readFile(modelLog, "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Record<string, unknown>)
  const jevRequests = (await readFile(jevLog, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>)
  if (!requests.length) throw new Error("OpenCode did not call the local fake provider")
  const jevStates = jevRequests.flatMap((request) => typeof request.state === "string" ? [JSON.parse(request.state) as { input?: { requiredRole?: string }; allowedRoles?: string[] }] : [])
  if (!jevStates.some((state) => state.allowedRoles?.includes("worker")) ||
      !jevStates.some((state) => state.input?.requiredRole === "catalog-researcher" && state.allowedRoles?.length === 1)) {
    throw new Error(`live Jev requests did not prove task and service-owned research routing: ${JSON.stringify(jevStates)}`)
  }
  const tools = requests.flatMap((request) => Array.isArray(request.tools) ? request.tools : [])
  const toolNames = tools.flatMap((tool) => typeof tool === "object" && tool !== null && "function" in tool && typeof tool.function === "object" && tool.function !== null && "name" in tool.function && typeof tool.function.name === "string" ? [tool.function.name] : [])
  const coordinatorRequests = requests.filter((request) => {
    const messages = Array.isArray(request.messages) ? request.messages as Array<{ role?: string; content?: unknown }> : []
    return messages.some((message) => message.role === "user" && typeof message.content === "string" && /MOMO_(?:TASK|PERMISSION)_/.test(message.content))
  })
  const coordinatorToolNames = [...new Set(coordinatorRequests.flatMap((request) => {
    const messages = Array.isArray(request.messages) ? request.messages as Array<{ role?: string; content?: unknown }> : []
    const prompt = messages.find((message) => message.role === "system" && typeof message.content === "string" && message.content.includes("You are momo's orchestrator"))?.content
    if (typeof prompt !== "string") return []
    const catalog = prompt.split("## Available tools").slice(1).join("## Available tools")
    return [...catalog.matchAll(/^[-*] ([A-Za-z0-9_]+)(?: \(|$)/gm)].map((match) => match[1])
  }))]
  if (coordinatorToolNames.some((name) => /^(?:shell|edit|write|apply_patch)$/.test(name))) {
    throw new Error(`coordinator Code Mode catalog exposed a forbidden tool: ${JSON.stringify(coordinatorToolNames)}`)
  }
  const catalogNames = [...new Set(requests.flatMap((request) => {
    const messages = Array.isArray(request.messages) ? request.messages as Array<{ role?: string; content?: unknown }> : []
    const system = messages.find((message) => message.role === "system")?.content
    const text = typeof system === "string" ? system : JSON.stringify(system ?? "")
    return [...text.matchAll(/tools\.([A-Za-z0-9_]+)/g)].map((match) => match[1]).filter((name) => name.startsWith("momo_"))
  }))]
  if (!catalogNames.includes("momo_task") || !catalogNames.includes("momo_consult")) throw new Error(`native tools were missing from the real Code Mode catalog: ${JSON.stringify(catalogNames)}`)
  if (catalogNames.includes("momo_catalog_enrich")) throw new Error(`catalog enrichment remains visible in the coordinator Code Mode catalog: ${JSON.stringify(catalogNames)}`)
  if (catalogNames.some((name) => name.startsWith("momo_task_") || name.startsWith("momo_consult_"))) throw new Error(`legacy task action aliases remain exposed: ${JSON.stringify(catalogNames)}`)
  const taskDeadline = Date.now() + 20_000
  let taskOutput: { tasks?: Array<{ prompt?: string; state?: string; role?: string; model?: { providerID: string; id: string } }> } | undefined
  let childTask: { prompt?: string; state?: string; role?: string; model?: { providerID: string; id: string } } | undefined
  while (Date.now() < taskDeadline) {
    const taskResponse = await client.rpc.call({ rpcID: "momo.native", method: "tasks", location: { directory: root }, input: { rootSessionID: taskSession.id } })
    taskOutput = taskResponse.output as typeof taskOutput
    childTask = taskOutput?.tasks?.find((task) => task.prompt === "MOMO_CHILD_PROBE")
    if (childTask?.state === "succeeded" || childTask?.state === "failed") break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (!childTask || childTask.state !== "succeeded" || childTask.role !== "worker" || childTask.model?.providerID !== "momo-qa") {
    throw new Error(`native task did not complete through the isolated provider: ${JSON.stringify(taskOutput)}`)
  }
  const manualSession = await client.session.create({ location: { directory: root }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
  await client.session.prompt({ sessionID: manualSession.id, text: "MOMO_TASK_MANUAL_SELECTION_PROBE" })
  await client.session.wait({ sessionID: manualSession.id })
  const manualDeadline = Date.now() + 20_000
  let manualTask: { prompt?: string; state?: string; role?: string; model?: { providerID: string; id: string } } | undefined
  while (Date.now() < manualDeadline) {
    const response = await client.rpc.call({ rpcID: "momo.native", method: "tasks", location: { directory: root }, input: { rootSessionID: manualSession.id } })
    const tasks = (response.output as { tasks?: Array<typeof manualTask> } | undefined)?.tasks ?? []
    manualTask = tasks.find((task) => task?.prompt === "MOMO_MANUAL_SELECTION_PROBE")
    if (manualTask?.state === "succeeded" || manualTask?.state === "failed") break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (!manualTask || manualTask.state !== "succeeded" || manualTask.role !== "planner" || manualTask.model?.id !== "momo-qa-model") {
    throw new Error(`manual selection did not reject valid-but-unoffered worker and dispatch offered planner: ${JSON.stringify(manualTask)}`)
  }
  const exportedDecisions = await client.rpc.call({ rpcID: "momo.native", method: "exportDecisions", location: { directory: root }, input: {} })
  const exportedLegacyLines = (exportedDecisions.output as { lines?: string[] } | undefined)?.lines ?? []
  if (!exportedLegacyLines.includes(legacyLedgerLine)) throw new Error("native exportDecisions RPC omitted the isolated legacy ledger line")
  if (await readFile(legacyLedgerPath, "utf8") !== `${legacyLedgerLine}\n`) throw new Error("legacy decision ledger was modified during native export")
  const directShellResult = requests.flatMap((request) => {
    const messages = Array.isArray(request.messages) ? request.messages as Array<{ role?: string; content?: unknown }> : []
    return messages.flatMap((message) => message.role === "tool" && typeof message.content === "string" && message.content.toLowerCase().includes("shell") ? [message.content] : [])
  })
  if (directShellResult.length === 0) throw new Error("the attempted direct shell call produced no tool response")
  const fakeCalls = (await readFile(callLog, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { userText: string; toolName: string; arguments: Record<string, unknown> })
  const directEditAttempt = fakeCalls.some((call) => call.toolName === "edit")
  if (!directEditAttempt) throw new Error("the fake provider did not attempt the coordinator edit wrapper")
  const pluginSetupMs = finalRows.find((row) => row.setup === true)?.setupMs
  if (typeof pluginSetupMs !== "number" || pluginSetupMs >= 2_000) throw new Error(`native plugin setup exceeded its 2s isolated budget: ${String(pluginSetupMs)}ms`)
  if (await Bun.file(deniedMarker).exists()) throw new Error("the coordinator direct shell call created its marker")
  const activePlugins = plugins.data.map((plugin) => ({ id: plugin.id, status: plugin.state.status }))
  const enrichAttempt = (await readFile(callLog, "utf8")).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as { userText: string; toolName: string }).find((call) => call.userText === "MOMO_CATALOG_ENRICH_DENY_PROBE")
  if (enrichAttempt?.toolName !== "momo_catalog_enrich") throw new Error("fake provider did not attempt direct momo_catalog_enrich execution")
  outcome = { version: execFileSync("opencode", ["--version"], { cwd: root, env: isolatedEnv(), encoding: "utf8" }).trim(), providerID: "momo-qa", modelID: "momo-qa-model", pluginID: "oh-my-openagent", pluginStatus: activePlugins.find((plugin) => plugin.id === "oh-my-openagent")?.status, pluginSetupMs, sessionID: session.id, shellSessionID: shellSession.id, editSessionID: editSession.id, taskSessionID: taskSession.id, manualSessionID: manualSession.id, enrichSessionID: enrichSession.id, researcherSessionID: researcherSession.id, childTask, manualTask, permissionHooks: finalRows.filter((row) => typeof row.action === "string"), coordinatorCodeModeTools: coordinatorToolNames, codeModeMomoTools: catalogNames, deniedDynamicImportMarkerCreated: false, directShellToolResult: directShellResult[0], shellWriteMarkerCreated: false, directEditAttempted: true, editMarkerContent: "unchanged", catalogEnrichVisibleInCodeMode: catalogNames.includes("momo_catalog_enrich"), catalogEnrichDenied: knowledgeAfter === knowledgeBefore, catalogResearcherEnrichAllowed: knowledgeResearched.includes("https://attacker.example/model"), legacyDecisionExported: exportedLegacyLines.includes(legacyLedgerLine), fakeModelRequests: requests.length, liveJevRequests: jevRequests.length, jevRequestBodyPath: path.join(evidenceDir, "jev-requests.jsonl"), actualRequestBodiesPath: path.join(evidenceDir, "request-bodies.jsonl") }
}

try {
  await main()
} catch (error) {
  outcome = { stage, failure: error instanceof Error ? error.message : String(error), opencodeOutput: opencodeOutput.slice(-5000) }
  process.exitCode = 1
} finally {
  if (opencode && opencode.exitCode === null) {
    opencode.kill("SIGTERM")
    await new Promise((resolve) => opencode?.once("exit", resolve))
  }
  if (modelServer?.listening) await new Promise<void>((resolve) => modelServer?.close(() => resolve()))
  await mkdir(evidenceDir, { recursive: true })
  if (await Bun.file(modelLog).exists()) await writeFile(path.join(evidenceDir, "request-bodies.jsonl"), await readFile(modelLog, "utf8"), { mode: 0o600 })
  if (await Bun.file(callLog).exists()) await writeFile(path.join(evidenceDir, "fake-tool-calls.jsonl"), await readFile(callLog, "utf8"), { mode: 0o600 })
  if (await Bun.file(jevLog).exists()) await writeFile(path.join(evidenceDir, "jev-requests.jsonl"), await readFile(jevLog, "utf8"), { mode: 0o600 })
  if (await Bun.file(setupLog).exists()) await writeFile(path.join(evidenceDir, "plugin-hook-log.jsonl"), await readFile(setupLog, "utf8"), { mode: 0o600 })
  const after = dbBefore === undefined ? undefined : realDatabaseCounts()
  const cleaned = { rootRemoved: false, localDatabaseUnchanged: JSON.stringify(dbBefore) === JSON.stringify(after), databaseBefore: dbBefore, databaseAfter: after }
  await rm(root, { recursive: true, force: true })
  cleaned.rootRemoved = true
  await writeFile(path.join(evidenceDir, "plugin-probe-result.json"), `${JSON.stringify({ ...outcome, cleanup: cleaned }, null, 2)}\n`, { mode: 0o600 })
  await writeFile(path.join(evidenceDir, "plugin-probe-cleanup.json"), `${JSON.stringify(cleaned, null, 2)}\n`, { mode: 0o600 })
  process.stdout.write(`${JSON.stringify({ ...outcome, cleanup: cleaned }, null, 2)}\n`)
}
