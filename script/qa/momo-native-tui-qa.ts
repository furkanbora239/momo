import { appendFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { spawn, execFileSync } from "node:child_process"
import { createServer as createHttpServer } from "node:http"
import { createServer as createNetServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"

const root = await mkdtemp(path.join(tmpdir(), "momo-native-tui-qa-"))
const evidence = process.env.MOMO_NATIVE_TUI_EVIDENCE ?? "/private/tmp/momo-v2-routing/.omo/evidence/20261011-native-acceptance"
const home = path.join(root, "home")
const xdg = Object.fromEntries(["data", "config", "state", "cache"].map((name) => [name, path.join(root, `xdg-${name}`)])) as Record<string, string>
const configDir = path.join(xdg.config, "opencode")
const pluginDir = path.join(root, ".opencode", "plugins")
const socket = path.join(root, "tmux.sock")
const tuiSession = `momo-native-tui-${path.basename(root)}`
const setupLog = path.join(root, "plugin-setup.jsonl")
const rpcLog = path.join(root, "rpc.jsonl")
let server: ReturnType<typeof createHttpServer> | undefined
let opencode: ReturnType<typeof spawn> | undefined
let modelPort = 0
let servicePort = 0
let output = ""
const modelRequests: Record<string, unknown>[] = []

function stringContent(value: unknown): string {
  if (typeof value === "string") return value
  if (!Array.isArray(value)) return ""
  return value.map((item) => item && typeof item === "object" && "text" in item && typeof item.text === "string" ? item.text : "").join(" ")
}

function responseStream(model: string, toolName?: string): string {
  const id = `qa-${Date.now()}`
  const delta = toolName
    ? { tool_calls: [{ index: 0, id: "call-qa", type: "function", function: { name: toolName, arguments: "{}" } }] }
    : { content: "isolated QA response" }
  return `data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: 1, model, choices: [{ index: 0, delta, finish_reason: toolName ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`
}

const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const safe = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(?:API[_-]?KEY|_KEY$|_TOKEN$|_SECRET$|PASSWORD)/i.test(key)))
  return { ...safe, OPENCODE_TEST_HOME: home, OPENCODE_CONFIG_DIR: configDir, XDG_DATA_HOME: xdg.data, XDG_CONFIG_HOME: xdg.config, XDG_STATE_HOME: xdg.state, XDG_CACHE_HOME: xdg.cache, OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_MODELS_FETCH: "1", NO_COLOR: "1", MOMO_QA_MODEL_URL: `http://127.0.0.1:${modelPort}/v1`, MOMO_QA_SETUP_LOG: setupLog, ...extra }
}

function runTmux(args: string[]): string {
  return execFileSync("tmux", ["-S", socket, ...args], { encoding: "utf8", timeout: 5000 })
}

async function waitFor(predicate: () => boolean, label: string, timeout = 20_000): Promise<void> {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function main(): Promise<void> {
  await mkdir(evidence, { recursive: true, mode: 0o700 })
  for (const dir of [home, ...Object.values(xdg), configDir, pluginDir, path.join(xdg.data, "opencode")]) await mkdir(dir, { recursive: true, mode: 0o700 })
  server = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1")
    if (request.method === "GET" && url.pathname.endsWith("/models")) {
      response.writeHead(200, { "content-type": "application/json" })
      response.end(JSON.stringify({ data: ["momo-qa-model-a", "momo-qa-model-b"].map((id) => ({ id, object: "model", created: 0, owned_by: "momo-qa" })) }))
      return
    }
    if (request.method === "POST") {
      let body = ""
      for await (const chunk of request) body += chunk.toString()
      output += body
      let parsed: Record<string, unknown> = {}
      try { parsed = JSON.parse(body) as Record<string, unknown> } catch (error) { throw new Error(`fake provider received invalid JSON: ${String(error)}`) }
      modelRequests.push(parsed)
      const messages = Array.isArray(parsed.messages) ? parsed.messages as Record<string, unknown>[] : []
      const userText = messages.filter((item) => item.role === "user").map((item) => stringContent(item.content)).join("\n")
      const requestedTool = /MOMO_QA_TOOL_CALL=([a-z0-9_]+)/i.exec(userText)?.[1]
      const hasToolCall = messages.some((item) => item.role === "assistant" && Array.isArray(item.tool_calls))
      const toolRows = Array.isArray(parsed.tools) ? parsed.tools as Record<string, unknown>[] : []
      const requested = requestedTool && !hasToolCall
        ? toolRows.find((item) => typeof item.function === "object" && item.function !== null && "name" in item.function && typeof item.function.name === "string" && item.function.name.toLowerCase().includes(requestedTool.toLowerCase()))
        : undefined
      const toolName = requested && typeof requested.function === "object" && requested.function !== null && "name" in requested.function && typeof requested.function.name === "string" ? requested.function.name : undefined
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" })
      response.end(responseStream(String(parsed.model ?? "momo-qa-model-a"), toolName))
      return
    }
    response.writeHead(404).end()
  })
  modelPort = await new Promise<number>((resolve, reject) => {
    server?.once("error", reject)
    server?.listen(0, "127.0.0.1", () => {
      const addr = server?.address()
      if (!addr || typeof addr === "string") return reject(new Error("fake provider failed to bind"))
      resolve(addr.port)
    })
  })
  const pluginPackageDir = path.join(pluginDir, "momo-native-qa")
  const pluginPath = path.join(pluginPackageDir, "index.ts")
  const tuiPath = path.join(pluginPackageDir, "tui.ts")
  const entryPath = "/private/tmp/momo-v2-baseline/packages/omo-opencode/src/index.ts"
  await mkdir(pluginPackageDir, { recursive: true, mode: 0o700 })
  await writeFile(path.join(pluginPackageDir, "package.json"), JSON.stringify({
    name: "oh-my-openagent",
    type: "module",
    exports: { ".": "./index.ts", "./tui": "./tui.ts" },
  }, null, 2) + "\n", { mode: 0o600 })
  await writeFile(pluginPath, [
    `import momo from ${JSON.stringify(entryPath)}`,
    'export default { id: "oh-my-openagent", async setup(ctx) {',
    '  await ctx.provider.transform((editor) => editor.add({ info: { id: "momo-qa", name: "Local QA", activation: "enabled", package: "aisdk:@ai-sdk/openai-compatible", settings: { baseURL: process.env.MOMO_QA_MODEL_URL, apiKey: "local-only" } }, models: ["momo-qa-model-a", "momo-qa-model-b"].map((id) => ({ id, modelID: id, providerID: "momo-qa", name: id, capabilities: { tools: true, input: ["text"], output: ["text"] }, variants: [], time: { released: 0 }, cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }], status: "active", enabled: true, limit: { context: 8192, output: 2048 } })) }))',
    '  await ctx.provider.reload()',
    '  const cleanup = await momo.setup(ctx)',
    '  return cleanup',
    '}}',
  ].join("\n"), { mode: 0o600 })
  await writeFile(tuiPath, `import { appendFileSync } from "node:fs"\nimport { Plugin } from "@opencode/plugin/tui"\nimport { createV2TuiSetup } from ${JSON.stringify(path.resolve("packages/omo-opencode/src/v2/tui/index.ts"))}\nappendFileSync(process.env.MOMO_QA_SETUP_LOG ?? "", "tui-import\\n")\nconst setup = createV2TuiSetup()\nexport default Plugin.define({ id: "oh-my-openagent", async setup(context) { appendFileSync(process.env.MOMO_QA_SETUP_LOG ?? "", "tui-setup\\n"); const cleanup = await setup(context); appendFileSync(process.env.MOMO_QA_SETUP_LOG ?? "", JSON.stringify({ location: context.location, commands: context.keymap.commands().filter((item) => item.id.startsWith("omo.native.")) })); return cleanup } })\n`, { mode: 0o600 })
  await writeFile(path.join(configDir, "opencode.json"), `${JSON.stringify({ plugins: [`file:${pluginPackageDir}`], model: "momo-qa/momo-qa-model-a" }, null, 2)}\n`, { mode: 0o600 })
  const installer = await import("/private/tmp/momo-v2-baseline/packages/omo-opencode/src/cli/config-manager/add-tui-plugin-to-tui-config.ts")
  const installerResult = installer.ensureTuiPluginEntry({ configDir, versionProbe: () => ({ available: true, version: "2.0.24", major: 2 }) })
  const installedConfig = await readFile(path.join(configDir, "opencode.json"), "utf8")
  const cliConfigExists = await readFile(path.join(configDir, "cli.json"), "utf8").then(() => true, () => false)
  await writeFile(path.join(evidence, "tui-installer-config.json"), JSON.stringify({ installerResult, config: JSON.parse(installedConfig), cliConfigExists }, null, 2) + "\n", { mode: 0o600 })
  if (installerResult.changed || cliConfigExists) throw new Error("v2 TUI installer unexpectedly changed the server entry or created a CLI entry")
  await writeFile(path.join(xdg.data, "opencode", "auth.json"), JSON.stringify({ "momo-qa": { type: "api", key: "local-only" } }), { mode: 0o600 })
  const password = `qa-${Date.now()}`
  await writeFile(path.join(configDir, "service.json"), JSON.stringify({ password }), { mode: 0o600 })
  servicePort = await freePort()
  opencode = spawn("opencode", ["serve", "--service", "--hostname", "127.0.0.1", "--port", String(servicePort)], { cwd: root, env: env(), stdio: ["ignore", "pipe", "pipe"] })
  let serverLog = ""
  opencode.stdout.on("data", (chunk: Buffer) => { serverLog += chunk.toString() })
  opencode.stderr.on("data", (chunk: Buffer) => { serverLog += chunk.toString() })
  const client = OpenCode.make({ baseUrl: `http://127.0.0.1:${servicePort}`, headers: { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` } })
  let providerReady = false
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline && !providerReady) {
    try { const result = await client.provider.list({ location: { directory: root } }); providerReady = result.data.some((item) => item.id === "momo-qa") } catch { await new Promise((resolve) => setTimeout(resolve, 250)) }
    if (!providerReady) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (!providerReady) throw new Error(`provider did not load: ${serverLog}`)
  const serverPlugins = await client.plugin.list({ location: { directory: root } })
  await writeFile(path.join(evidence, "tui-server-plugins.json"), `${JSON.stringify(serverPlugins, null, 2)}\n`, { mode: 0o600 })
  await writeFile(path.join(evidence, "tui-server-startup.log"), `${serverLog}\n`, { mode: 0o600 })
  const snapBefore = await client.rpc.call({ rpcID: "momo.native", method: "catalogSnapshot", location: { directory: root }, input: {} })
  await appendFile(rpcLog, `${JSON.stringify({ event: "before", output: snapBefore.output })}\n`, { mode: 0o600 })
  const roleSurfaceRequests: Record<string, unknown>[] = []
  for (const agent of ["momo-orchestrator", "momo-worker", "momo-advisor"]) {
    const session = await client.session.create({ location: { directory: root }, agent, model: { providerID: "momo-qa", id: "momo-qa-model-a" }, title: `native search ${agent}` })
    await client.session.prompt({ sessionID: session.id, text: `Native search surface check for ${agent}` })
    await client.session.wait({ sessionID: session.id })
    const requestBody = modelRequests.at(-1)
    roleSurfaceRequests.push({ agent, sessionID: session.id, modelRequest: requestBody })
  }
  await writeFile(path.join(evidence, "native-search-model-surfaces.json"), `${JSON.stringify(roleSurfaceRequests, null, 2)}\n`, { mode: 0o600 })
  const tuiEnv = env({ OPENCODE_PASSWORD: password })
  const command = `env ${Object.entries(tuiEnv).filter(([key]) => key.startsWith("OPENCODE_") || key.startsWith("XDG_") || key === "NO_COLOR" || key === "MOMO_QA_MODEL_URL" || key === "MOMO_QA_SETUP_LOG").map(([key, val]) => `${key}=${JSON.stringify(val)}`).join(" ")} opencode --server http://127.0.0.1:${servicePort} ${JSON.stringify(root)}`
  runTmux(["new-session", "-d", "-s", tuiSession, "-x", "150", "-y", "44"])
  runTmux(["send-keys", "-t", tuiSession, command, "Enter"])
  let lastPane = ""
  try {
    await waitFor(() => {
      try { lastPane = runTmux(["capture-pane", "-pt", tuiSession]); return lastPane.includes("Ask anything") || lastPane.includes("Ask anything") } catch { return false }
    }, "OpenCode TUI composer")
  } catch (error) {
    await writeFile(path.join(evidence, "tui-launch-failure.txt"), `${String(error)}\n\nSERVER CONFIG:\n${await readFile(path.join(configDir, "opencode.json"), "utf8")}\n\nPANE:\n${lastPane}\n\nSERVER:\n${serverLog}\n`, { mode: 0o600 })
    throw error
  }
  const initial = runTmux(["capture-pane", "-pt", tuiSession])
  if (initial.includes("Plugin failed:")) {
    runTmux(["send-keys", "-t", tuiSession, "Escape"])
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  runTmux(["send-keys", "-t", tuiSession, "/pool", "Enter"])
  await new Promise((resolve) => setTimeout(resolve, 300))
  runTmux(["send-keys", "-t", tuiSession, "Enter"])
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const poolPanel = runTmux(["capture-pane", "-pt", tuiSession])
  runTmux(["send-keys", "-t", tuiSession, "Enter"])
  await new Promise((resolve) => setTimeout(resolve, 400))
  const poolUpdatedPanel = runTmux(["capture-pane", "-pt", tuiSession])
  runTmux(["send-keys", "-t", tuiSession, "Escape"])
  await new Promise((resolve) => setTimeout(resolve, 300))
  runTmux(["send-keys", "-t", tuiSession, "C-u"])
  runTmux(["send-keys", "-t", tuiSession, "/providers", "Enter"])
  await new Promise((resolve) => setTimeout(resolve, 300))
  runTmux(["send-keys", "-t", tuiSession, "Enter"])
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const providersPanel = runTmux(["capture-pane", "-pt", tuiSession])
  runTmux(["send-keys", "-t", tuiSession, "Enter"])
  await new Promise((resolve) => setTimeout(resolve, 400))
  const providersUpdatedPanel = runTmux(["capture-pane", "-pt", tuiSession])
  runTmux(["send-keys", "-t", tuiSession, "Escape"])
  await new Promise((resolve) => setTimeout(resolve, 300))
  runTmux(["send-keys", "-t", tuiSession, "C-u"])
  runTmux(["send-keys", "-t", tuiSession, "/advisor-pool", "Enter"])
  await new Promise((resolve) => setTimeout(resolve, 300))
  runTmux(["send-keys", "-t", tuiSession, "Enter"])
  await new Promise((resolve) => setTimeout(resolve, 1500))
  const advisorPanel = runTmux(["capture-pane", "-pt", tuiSession])
  runTmux(["send-keys", "-t", tuiSession, "Enter"])
  await new Promise((resolve) => setTimeout(resolve, 400))
  const advisorUpdatedPanel = runTmux(["capture-pane", "-pt", tuiSession])
  runTmux(["send-keys", "-t", tuiSession, "Escape"])
  const actualPanels = { pool: poolPanel, poolAfterToggle: poolUpdatedPanel, providers: providersPanel, providersAfterToggle: providersUpdatedPanel, advisorPool: advisorPanel, advisorPoolAfterToggle: advisorUpdatedPanel }
  await writeFile(path.join(evidence, "tui-panels.txt"), JSON.stringify({ initial, ...actualPanels }, null, 2) + "\n", { mode: 0o600 })
  await writeFile(path.join(evidence, "tui-final-pane.txt"), runTmux(["capture-pane", "-pt", tuiSession]), { mode: 0o600 })
  const hasPool = poolPanel.includes("Model pool") && poolPanel.includes("momo-qa-model-a")
  const hasProviders = providersPanel.includes("Providers") && providersPanel.includes("momo-qa")
  const hasAdvisor = advisorPanel.includes("Advisor pool") && advisorPanel.includes("momo-qa-model-a")
  if (!(hasPool && hasProviders && hasAdvisor)) throw new Error(`TUI panels did not render as expected: ${JSON.stringify({ hasPool, hasProviders, hasAdvisor })}`)
  const poolFile = path.join(home, ".omo", "model-pool.json")
  const providerFile = path.join(home, ".omo", "provider-toggles.json")
  const advisorFiles = [path.join(root, ".omo", "omo.jsonc"), path.join(home, ".omo", "omo.jsonc")]
  const stores = { pool: await readFile(poolFile, "utf8").catch(() => null), providers: await readFile(providerFile, "utf8").catch(() => null), advisor: await Promise.any(advisorFiles.map((file) => readFile(file, "utf8"))).catch(() => null) }
  await writeFile(path.join(evidence, "control-store-after.json"), JSON.stringify(stores, null, 2) + "\n", { mode: 0o600 })
  if (!stores.pool || !stores.pool.includes("momo-qa-model-b") || !stores.providers?.includes("opencode") || !stores.advisor?.includes("advisor_models")) {
    throw new Error(`TUI controls did not persist toggles: ${JSON.stringify({ pool: Boolean(stores.pool), providers: Boolean(stores.providers), advisor: Boolean(stores.advisor) })}`)
  }
  await writeFile(path.join(evidence, "tui-meta.json"), JSON.stringify({ opencodePID: opencode.pid, servicePort, modelPort, tmuxSocket: socket, tmuxSession: tuiSession, cwd: root, xdg, envKeys: ["OPENCODE_TEST_HOME", "OPENCODE_CONFIG_DIR", "XDG_DATA_HOME", "XDG_CONFIG_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"], providerID: "momo-qa", models: ["momo-qa-model-a", "momo-qa-model-b"], panels: { pool: hasPool, providers: hasProviders, advisorPool: hasAdvisor }, cleanup: "pending" }, null, 2) + "\n", { mode: 0o600 })
}

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const sock = createNetServer()
    sock.once("error", reject)
    sock.listen(0, "127.0.0.1", () => {
      const address = sock.address()
      if (!address || typeof address === "string") return reject(new Error("could not allocate service port"))
      sock.close(() => resolve(address.port))
    })
  })
}

let failure: unknown
try { await main() } catch (error) { failure = error } finally {
  try { await writeFile(path.join(evidence, "tui-plugin-setup.jsonl"), await readFile(setupLog, "utf8"), { mode: 0o600 }) } catch (error) {
    if (!(error instanceof Error) || !("code" in error && error.code === "ENOENT")) failure ??= error
  }
  const logRoot = path.join(xdg.data, "opencode", "log")
  try {
    const names = await readdir(logRoot)
    for (const name of names.filter((item) => item.endsWith(".log"))) {
      const content = await readFile(path.join(logRoot, name), "utf8")
      await writeFile(path.join(evidence, `tui-cli-${name}`), content, { mode: 0o600 })
    }
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error && error.code === "ENOENT")) failure ??= error
  }
  try { execFileSync("tmux", ["-S", socket, "kill-server"], { timeout: 5000, stdio: "ignore" }) } catch (error) { if (!(error instanceof Error)) failure ??= error }
  if (opencode && opencode.exitCode === null) {
    const stopped = new Promise<void>((resolve) => opencode?.once("exit", () => resolve()))
    opencode.kill("SIGTERM")
    await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 3000))])
    if (opencode.exitCode === null) {
      opencode.kill("SIGKILL")
      await Promise.race([stopped, new Promise((resolve) => setTimeout(resolve, 3000))])
    }
  }
  server?.close()
  const cleanup = { tmuxServerStopped: true, opencodePID: opencode?.pid, opencodeExitCode: opencode?.exitCode, opencodeStopped: opencode?.exitCode !== null, fakeProviderStopped: true, isolatedRoot: root }
  await writeFile(path.join(evidence, "tui-cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`, { mode: 0o600 }).catch(() => undefined)
  await rm(root, { recursive: true, force: true })
}
if (failure) throw failure
