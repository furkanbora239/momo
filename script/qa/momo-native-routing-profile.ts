#!/usr/bin/env bun
// MODIFIED: real OpenCode server and TUI with an isolated chat provider and no Jev.
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { copyFile, mkdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { routingStatus } from "../../packages/omo-opencode/src/native-runtime/routing-profile-rpc"
import { harness, until } from "./momo-native-job-classification-harness"
import { contractFixture, contractResponse, type ContractRequest } from "./momo-native-tool-contract-fixture"

const binary = process.env.MOMO_NATIVE_OPENCODE_BIN
const bundle = process.env.MOMO_NATIVE_BUNDLE_DIR
assert(binary && bundle, "Set MOMO_NATIVE_OPENCODE_BIN and MOMO_NATIVE_BUNDLE_DIR")
const evidence = resolve(process.env.MOMO_NATIVE_EVIDENCE_DIR ?? ".omo/evidence/20261125-native-routing")
await mkdir(evidence, { recursive: true })
const qa = await harness(binary, evidence, { allowConcurrentMessageWrites: true })
const report: Record<string, unknown> = { status: "running", liveProviderCalls: false }
const requests = { draft: 0, routing: 0, worker: 0, jev: 0 }
const errors: string[] = []
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
  try {
    const path = new URL(request.url).pathname
    if (request.method === "GET" && path.endsWith("/models")) return Response.json({ data: ["root", "worker", "advisor"].map(id => ({ id })) })
    if (path.endsWith("/systemone")) { requests.jev++; return Response.json({ error: "Jev unavailable" }, { status: 503 }) }
    const body = await request.json() as ContractRequest & { stream?: boolean }
    const prompt = JSON.stringify(body.messages)
    function selectionInput() {
      const content = body.messages.at(-1)?.content
      if (typeof content !== "string") return
      try {
        const value = JSON.parse(content.split("\n").at(-1) ?? "{}")
        if (Array.isArray(value?.options)) return value as { options: { model: string; index: number }[]; task?: unknown }
      } catch {
        return undefined
      }
    }
    function reply(text: string) {
      if (body.stream) return contractResponse(body.model, { text })
      return Response.json({ id: "momo-routing-qa", object: "chat.completion", created: 1, model: body.model,
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } })
    }
    const selection = selectionInput()
    if (selection && !selection.task) {
      requests.draft++
      assert(!body.tools?.length, "Draft generation advertised tools")
      const decision = selection.options.find(model => model.model === "openai/root")?.index
      const worker = selection.options.find(model => model.model === "openai/worker")?.index
      assert(decision !== undefined && worker !== undefined)
      return reply(JSON.stringify({ decision, workers: [worker], reasons: { decision: "Connected chat decision model.", workers: "Tool-capable worker." } }))
    }
    if (selection?.task) {
      requests.routing++
      assert.equal(body.model, "root")
      assert(!body.tools?.length, "Decision generation advertised tools")
      const worker = selection.options.find(model => model.model === "openai/worker")?.index
      assert(worker !== undefined)
      return reply(JSON.stringify({ model: worker, role: "worker", reason: "Bounded fixture work." }))
    }
    if (body.model === "worker") {
      requests.worker++
      return reply("ROUTING_QA_WORKER_DONE")
    }
    if (prompt.includes("ROUTING_QA_CREATE_CHILD") && body.tools?.some(tool => tool.function?.name === "execute") && !body.messages.some(message => message.role === "tool")) {
      return contractResponse(body.model, { code: `return await tools.momo_task({ action: "create", prompt: "ROUTING_QA_WORKER", view: "brief" });` })
    }
    return reply("ROUTING_QA_ROOT_READY")
  } catch (error) {
    errors.push(String(error))
    return Response.json({ error: { message: "Invalid routing QA fixture request" } }, { status: 500 })
  }
} })
const socket = join(qa.root, "tmux.sock")
const tmux = (...args: string[]) => execFileSync("tmux", ["-S", socket, ...args], { encoding: "utf8", timeout: 8000 })
let target = "routing:0"
const send = (...keys: string[]) => tmux("send-keys", "-t", target, ...keys)
const frame = () => tmux("capture-pane", "-t", target, "-p")
const expectFrame = (pattern: RegExp, stage: string) => until(async () => frame(), value => pattern.test(value), stage, 12000)
async function select(label: string, next: RegExp) {
  send("-l", label)
  await Bun.sleep(250)
  send("Enter")
  return expectFrame(next, label)
}
let terminal = false
try {
  await writeFile(join(qa.plugin, "package.json"), JSON.stringify({ name: "momo-routing-qa", type: "module", exports: { ".": "./index.js", "./tui": "./tui.js" } }))
  const fixture = contractFixture(join(bundle, "index.js"), `http://127.0.0.1:${server.port}`)
    .replaceAll("contract", "openai").replace("modelID:id,providerID:", 'modelID:id,type:"chat",providerID:')
  await writeFile(join(qa.plugin, "index.js"), fixture)
  const tuiEntry = JSON.stringify(join(bundle, "tui.js"))
  await writeFile(join(qa.plugin, "tui.js"), `export { default } from ${tuiEntry};`)
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "service.json"), JSON.stringify({ password: "local-qa" }))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "opencode.json"), JSON.stringify({
    plugins: [`file:${qa.plugin}`], model: "openai/root",
  }))
  await writeFile(join(qa.project, ".omo/omo.jsonc"), JSON.stringify({ "[opencode]": {
    catalog: { auto_research: false },
    manager: { jev: { provider_id: "missing-jev", base_url: `http://127.0.0.1:${server.port}/jev/v1`, model: "unavailable", max_attempts: 1 } },
  } }))
  const client = await qa.start()
  report.version = (await client.server.info()).version
  const rpc = async (method: string, input: Parameters<typeof client.rpc.call>[0]["input"] = {}) =>
    (await client.rpc.call({ rpcID: "momo.routing", method, input, location: { directory: qa.project } })).output
  const snapshot = async () => routingStatus.parse(await rpc("snapshot"))
  assert.equal((await snapshot()).jev.available, false)

  tmux("new-session", "-d", "-s", "routing", "-c", qa.project, "-x", "135", "-y", "42", "env", "-i",
    ...Object.entries(qa.env).filter(([key]) => key !== "NO_COLOR").map(([key, value]) => `${key}=${value}`), "TERM=xterm-256color", binary, qa.project)
  terminal = true
  const panePID = Number(tmux("display-message", "-t", "routing", "-p", "#{pane_pid}").trim())
  qa.trackOwnedProcessGroup(panePID)
  tmux("pipe-pane", "-t", "routing", "cat > " + JSON.stringify(join(evidence, "capture.ansi")))
  await expectFrame(/Ask anything|ctrl\+p/, "OpenCode TUI")
  send("-l", "/momo-routing")
  await expectFrame(/\/momo-routing\s+Momo routing/, "routing slash suggestion")
  send("Enter")
  await expectFrame(/Momo routing.*Automatic/, "routing command")
  await select("Switch profile", /Routing profiles/)
  await select("ChatGPT", /Momo routing.*ChatGPT/)
  await select("Fill with AI", /Choose AI to prepare/)
  await select("root", /Decision model.*openai\/root/)
  assert.equal((await snapshot()).revision, "", "AI draft was persisted before confirmation")
  await writeFile(join(evidence, "draft-smoke.txt"), frame())
  tmux("pipe-pane", "-t", target)
  await select("Apply profile", /Activate ChatGPT routing profile/)
  send("Enter")
  await until(snapshot, status => status.active === "chatgpt", "profile persisted from TUI", 10000)
  const active = await snapshot()
  assert.deepEqual(active.profiles.chatgpt?.decision, { kind: "chat", model: { providerID: "openai", id: "root" } })
  assert.deepEqual(active.profiles.chatgpt?.pool, { mode: "allowlist", models: [{ providerID: "openai", id: "worker" }] })

  const root = await client.session.create({ location: { directory: qa.project }, agent: "momo-orchestrator", model: { providerID: "openai", id: "root" } })
  await client.session.prompt({ sessionID: root.id, text: "ROUTING_QA_CREATE_CHILD" })
  const tasks = async () => {
    const response = await client.rpc.call({ rpcID: "momo.native", method: "tasks", input: { rootSessionID: root.id }, location: { directory: qa.project } })
    return (response.output as { tasks: { state: string; model?: { id: string; providerID: string }; role?: string }[] }).tasks
  }
  const completed = await until(tasks, items => items.some(task => task.state === "succeeded"), "worker completed through chat decision", 30000)
  assert(completed.some(task => task.state === "succeeded" && task.role === "worker" && task.model?.id === "worker"))
  assert.deepEqual(requests, { draft: 1, routing: 1, worker: 1, jev: 0 })
  assert.equal((await snapshot()).lastDecision?.selected?.by, "chat")
  assert.deepEqual(errors, [])

  tmux("new-window", "-t", "routing", "-n", "session", "-c", qa.project, "env", "-i",
    ...Object.entries(qa.env).filter(([key]) => key !== "NO_COLOR").map(([key, value]) => `${key}=${value}`),
    "TERM=xterm-256color", binary, "--session", root.id, qa.project)
  target = "routing:session"
  qa.trackOwnedProcessGroup(Number(tmux("display-message", "-p", "-t", target, "#{pane_pid}").trim()))
  await expectFrame(/ROUTING_QA_ROOT_READY|ctrl\+p/, "active OpenCode session")
  send("C-p")
  await expectFrame(/Search commands/, "pool command palette")
  await select("Momo routing", /Momo routing.*ChatGPT/)
  await select("Worker pool", /Worker model pool/)
  await select("Only selected models", /Select worker models/)
  send("-l", "worker")
  await expectFrame(/worker/, "worker model filter")
  send("C-Space")
  await expectFrame(/removed from draft/, "remove checked worker while filtering")
  await expectFrame(/\[ \] worker/, "updated unchecked worker row")
  send("C-s")
  await expectFrame(/Worker pool.*0 eligible/, "empty worker draft")
  await select("Apply profile", /Activate ChatGPT routing profile/)
  send("Enter")
  await until(snapshot, status => status.profiles.chatgpt?.pool.models.length === 0, "empty allowlist persisted", 10000)
  const paused = await snapshot()
  assert.deepEqual(paused.profiles.chatgpt?.pool, { mode: "allowlist", models: [] })
  await rpc("provider", { providerID: "openai", allowed: false })
  assert.equal((await snapshot()).providers.find(provider => provider.id === "openai")?.allowed, false)
  await rpc("provider", { providerID: "openai", allowed: true })
  assert.equal((await snapshot()).providers.find(provider => provider.id === "openai")?.connected, true)
  tmux("pipe-pane", "-t", target, "cat > " + JSON.stringify(join(evidence, "capture-side-panel.ansi")))
  send("C-p")
  await expectFrame(/Search commands/, "session command palette")
  await select("Momo routing", /Momo routing.*ChatGPT/)
  await select("Show alongside session", /Edit or refresh with \/momo-routing/)
  await until(async () => frame(), text => !text.includes("Routing profile applied"), "status capture after notification clears", 10000)
  await writeFile(join(evidence, "side-panel-smoke.txt"), frame())
  tmux("pipe-pane", "-t", target)
  tmux("resize-window", "-t", target, "-x", "72", "-y", "36")
  await Bun.sleep(350)
  await expectFrame(/Edit or refresh with \/momo-routing/, "routing panel on a narrow terminal")
  await writeFile(join(evidence, "narrow-panel-smoke.txt"), frame())

  report.status = "passed"
  report.checks = ["TUI AI draft held until Apply", "ChatGPT profile activated", "momo_task worker completed with Jev unavailable", "exact chat and worker requests",
    "native session status panel at 135 and 72 columns", "filtered bulk action emptied allowlist without opening it", "provider exclusion reflected in fresh snapshot"]
} catch (error) {
  report.status = "failed"
  report.error = String(error)
  if (terminal) await writeFile(join(evidence, "failure-smoke.txt"), frame()).catch(() => undefined)
  await copyFile(join(qa.env.XDG_DATA_HOME!, "opencode/log/opencode.log"), join(evidence, "isolated-opencode.log")).catch(() => undefined)
  throw error
} finally {
  if (terminal) try { tmux("kill-server") } catch (error) { report.terminalCleanupError = String(error) }
  server.stop(true)
  report.requests = requests
  report.fixtureErrors = errors
  try { report.cleanup = await qa.cleanup() }
  finally { await writeFile(join(evidence, "receipt.json"), JSON.stringify(report, null, 2) + "\n") }
}
console.log(JSON.stringify(report, null, 2))
