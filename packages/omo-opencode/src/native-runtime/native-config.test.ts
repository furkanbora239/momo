import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"
import { loadNativeRuntimeConfig } from "./native-config"

const temporaryRoots: string[] = []

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "momo-native-config-test-"))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe("native OpenCode configuration", () => {
  test("loads the selected home layer and project overrides without applying the V1 config view", async () => {
    const realHome = await makeRoot()
    const isolatedHome = await makeRoot()
    const project = await makeRoot()
    await Promise.all([
      mkdir(join(realHome, ".omo"), { recursive: true }),
      mkdir(join(isolatedHome, ".omo"), { recursive: true }),
      mkdir(join(project, ".omo"), { recursive: true }),
    ])
    await writeFile(join(realHome, ".omo/omo.jsonc"), JSON.stringify({ "[opencode]": {
      manager: { jev: { budget: { monthly_cap_usd: 101 } } },
      background_task: { staleTimeoutMs: 111_000 },
      default_run_agent: "real-home-agent",
      agents: { task: { models: ["provider/real"] } },
    } }))
    await writeFile(join(isolatedHome, ".omo/omo.jsonc"), JSON.stringify({ "[opencode]": {
      manager: { jev: { budget: { monthly_cap_usd: 19 } } },
      background_task: { staleTimeoutMs: 222_000 },
      default_run_agent: "isolated-home-agent",
      agents: { task: { models: ["provider/isolated"] } },
    } }))
    await writeFile(join(project, ".omo/omo.jsonc"), JSON.stringify({ "[opencode]": {
      background_task: { maxToolCalls: 23 },
      default_run_agent: "project-agent",
    } }))

    const config = loadNativeRuntimeConfig(project, { homeDirectory: isolatedHome })

    expect(config.manager?.jev.budget.monthly_cap_usd).toBe(19)
    expect(config.background_task).toEqual({ staleTimeoutMs: 222_000, maxToolCalls: 23 })
    expect(config.default_run_agent).toBe("project-agent")
    expect("agents" in config).toBe(false)
    expect(config.manager?.advisor_models).toEqual([])
  })
})
