#!/usr/bin/env bun
// MODIFIED: exercise automatic MCP startup adoption in the real noninteractive installer.
import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { delimiter, dirname, join } from "node:path"
import { harness } from "./momo-native-job-classification-harness"
import { nativeMcpRegistryPath, readNativeMcpRegistry } from "../../packages/omo-opencode/src/native-mcp/registry"

const binary = process.env.MOMO_NATIVE_OPENCODE_BIN
assert(binary, "Set MOMO_NATIVE_OPENCODE_BIN")
const evidence = process.env.MOMO_NATIVE_EVIDENCE_DIR ?? join(process.cwd(), ".omo/evidence/20261114-project-mcps/installer")
await mkdir(evidence, { recursive: true })
const qa = await harness(binary, evidence, { allowConcurrentMessageWrites: true })
const result: Record<string, unknown> = { proof: "compiled CLI installer with isolated HOME and native configuration", credentialsCopied: false }
try {
  const configPath = join(qa.env.OPENCODE_CONFIG_DIR!, "opencode.json")
  await writeFile(configPath, JSON.stringify({ plugin: [`file:${join(process.cwd(), "dist/index.js")}`], mcp: { servers: { appwrite: { type: "local", command: ["node", "unused.js"], environment: { SAMPLE: "{env:MOMO_QA_VALUE}" } } } } }))
  const output = execFileSync("node", [join(process.cwd(), "dist/cli-node/index.js"), "install", "--no-tui", "--claude=no", "--gemini=no", "--copilot=no", "--skip-auth"], { cwd: qa.project, env: { ...qa.env, PATH: dirname(binary) + delimiter + qa.env.PATH, OMO_DISABLE_POSTHOG: "1", npm_config_prefix: join(qa.root, "npm-global"), npm_config_cache: join(qa.root, "npm-cache") }, encoding: "utf8", timeout: 90000, maxBuffer: 4 * 1024 * 1024 })
  await writeFile(join(evidence, "installer.log"), output)
  const config = JSON.parse(await readFile(configPath, "utf8")) as { plugins?: unknown[]; mcp?: { servers?: Record<string, { disabled?: boolean; environment?: Record<string, string> }> } }
  assert(Array.isArray(config.plugins), "Installer did not retain native v2 configuration")
  assert.equal(config.mcp?.servers?.appwrite?.disabled, true)
  assert.equal(config.mcp?.servers?.appwrite?.environment?.SAMPLE, "{env:MOMO_QA_VALUE}")
  const registry = await readNativeMcpRegistry(nativeMcpRegistryPath(qa.env.HOME!, qa.env.OPENCODE_CONFIG_DIR!))
  assert.equal(registry.appwrite?.disabled, false)
  assert(!existsSync(join(qa.root, "npm-global")), "Installer invoked a global package manager")
  assert(existsSync(join(qa.env.HOME!, ".omo/runtime/ast-grep", `${process.platform}-${process.arch}`, process.platform === "win32" ? "sg.exe" : "sg")), "Managed runtime was not prepared")
  result.noGlobalPackageInstall = true
  result.automaticStartupAdoption = true
  result.nativeTemplatesPreserved = true
  result.passed = true
} finally {
  result.cleanup = await qa.cleanup()
  await writeFile(join(evidence, "result.json"), JSON.stringify(result, null, 2))
}
console.log(JSON.stringify(result, null, 2))
