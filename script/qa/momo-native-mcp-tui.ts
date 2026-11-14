#!/usr/bin/env bun
// MODIFIED: exercise the actual project MCP dialog in the native terminal renderer.
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { harness, until } from "./momo-native-job-classification-harness"
import { contractFixture, contractResponse, type ContractRequest } from "./momo-native-tool-contract-fixture"
import { adoptNativeMcpServers, nativeMcpRegistryPath } from "../../packages/omo-opencode/src/native-mcp/registry"

const binary = process.env.MOMO_NATIVE_OPENCODE_BIN
assert(binary, "Set MOMO_NATIVE_OPENCODE_BIN")
const evidence = process.env.MOMO_NATIVE_EVIDENCE_DIR ?? join(process.cwd(), ".omo/evidence/20261114-project-mcps/tui")
await mkdir(evidence, { recursive: true })
const qa = await harness(binary, evidence, { allowConcurrentMessageWrites: true })
const sessionName = "momo-mcp-qa-" + crypto.randomUUID().slice(0, 8)
let tmuxStarted = false
const result: Record<string, unknown> = { proof: "real native TUI dialog driven through tmux, not visual layout QA" }
const server = Bun.serve({ port: 0, async fetch(request) {
  if (request.method === "GET") return Response.json({ data: [{ id: "root" }] })
  const body = await request.json() as ContractRequest
  return contractResponse(body.model, { text: "TUI_QA_NO_MODEL_WORK" })
} })
const tmux = (...args: string[]) => execFileSync("tmux", args, { encoding: "utf8", timeout: 10000 })
const capture = () => tmux("capture-pane", "-p", "-t", sessionName)
try {
  await writeFile(join(qa.plugin, "package.json"), JSON.stringify({ name: "mcp-tui-qa", type: "module", exports: { ".": "./index.js", "./tui": "./tui.js" } }))
  await writeFile(join(qa.plugin, "index.js"), contractFixture(join(process.cwd(), "dist/index.js"), `http://127.0.0.1:${server.port}`))
  await writeFile(join(qa.plugin, "tui.js"), `import original from ${JSON.stringify(join(process.cwd(), "dist/tui.js"))};import fs from "node:fs";export default {...original,async setup(ctx){const cleanup=await original.setup(ctx);fs.writeFileSync(${JSON.stringify(join(qa.root,"tui-ready"))},"ready");return cleanup}};`)
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "service.json"), JSON.stringify({ password: "local-qa" }))
  await writeFile(join(qa.env.OPENCODE_CONFIG_DIR!, "opencode.json"), JSON.stringify({ plugins: [`file:${qa.plugin}`], model: "contract/root", agent: "momo-orchestrator", mcp: { servers: { appwrite: { type: "local", command: ["node", "unused.js"] } } } }))
  await writeFile(join(qa.project, ".omo/omo.jsonc"), JSON.stringify({ "[opencode]": { catalog: { auto_research: false } } }))
  const registry = nativeMcpRegistryPath(qa.env.HOME!, qa.env.OPENCODE_CONFIG_DIR!)
  await adoptNativeMcpServers({ configPath: join(qa.env.OPENCODE_CONFIG_DIR!, "opencode.json"), registryPath: registry })
  const client = await qa.start()
  const info = await client.server.info()
  result.version = info.version
  assert(info.urls[0], "Native server did not advertise its URL")
  await writeFile(join(evidence, "server-info.json"), JSON.stringify(info, null, 2))
  const bounded = process.platform === "linux" ? ["taskset", "-c", "0-3", "nice", "-n", "10"] : []
  const args = ["new-session", "-d", "-s", sessionName, "-c", qa.project, "-x", "150", "-y", "48", "env", "-i", ...Object.entries(qa.env).map(([key, value]) => `${key}=${value}`), "TERM=xterm-256color", "GOMAXPROCS=4", ...bounded, binary, "--standalone", qa.project]
  tmux(...args); tmuxStarted = true
  const panePID = Number(tmux("display-message", "-p", "-t", sessionName, "#{pane_pid}").trim())
  const group = Number(execFileSync("ps", ["-o", "pgid=", "-p", String(panePID)], { encoding: "utf8" }).trim())
  assert.equal(group, panePID, "TUI did not create its own process group")
  qa.trackOwnedProcessGroup(group)
  await qa.capture()
  await until(async () => existsSync(join(qa.root,"tui-ready")), Boolean, "actual TUI plugin setup", 30000)
  const rendered = await until(async () => capture(), text => /Ask anything|ctrl\+p|momo-orchestrator/.test(text), "native TUI render", 30000)
  await writeFile(join(evidence, "render.txt"), rendered)
  tmux("send-keys", "-t", sessionName, "C-p")
  const palette = await until(async () => capture(), text => text.includes("Commands"), "native command palette", 10000)
  await writeFile(join(evidence, "palette.txt"), palette)
  tmux("send-keys", "-t", sessionName, "-l", "Project MCPs")
  await until(async () => capture(), text => text.includes("Project MCPs Persistent MCP policy"), "project MCP command selection", 10000)
  tmux("send-keys", "-t", sessionName, "Enter")
  const panel = await until(async () => capture(), text => text.includes("Project MCPs") && text.includes("appwrite"), "project MCP panel", 15000)
  await writeFile(join(evidence, "panel.txt"), panel)
  tmux("send-keys", "-t", sessionName, "-l", "appwrite")
  await until(async () => capture(), text => (text.match(/appwrite/g)?.length ?? 0) >= 2, "MCP server filter", 10000)
  tmux("send-keys", "-t", sessionName, "Enter")
  const mode = await until(async () => capture(), text => text.includes("On demand") && text.includes("Always"), "MCP mode selector", 10000)
  await writeFile(join(evidence, "modes.txt"), mode)
  tmux("send-keys", "-t", sessionName, "Enter")
  await until(async () => JSON.parse(await readFile(join(qa.project, ".omo/omo.jsonc"), "utf8")) as { "[opencode]"?: { mcp_policy?: { appwrite?: string } } }, config => config["[opencode]"]?.mcp_policy?.appwrite === "off", "TUI mode persisted through native RPC", 10000)
  result.persistedOff = true
  result.passed = true
} finally {
  try {
    if (tmuxStarted) {
      const state = spawnSync("tmux", ["has-session", "-t", sessionName], { stdio: "ignore" })
      if (state.error) throw state.error
      if (state.status === 0) {
        await writeFile(join(evidence, "pane-before-cleanup.txt"), capture())
        tmux("kill-session", "-t", sessionName)
      }
      else assert.equal(state.status, 1, "Cannot inspect owned tmux session")
    }
  } finally {
    server.stop(true)
    result.cleanup = await qa.cleanup()
  }
  const remaining = spawnSync("tmux", ["has-session", "-t", sessionName], { stdio: "ignore" })
  if (remaining.error) throw remaining.error
  assert.equal(remaining.status, 1, "Owned tmux session still exists")
  result.tmuxSessionGone = true
  await writeFile(join(evidence, "result.json"), JSON.stringify(result, null, 2))
}
console.log(JSON.stringify(result, null, 2))
