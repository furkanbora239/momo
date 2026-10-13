import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import tuiModule, { createV2TuiSetup } from "./index"
import { createFakeV2TuiContext } from "./fake-tui-context"
import { registerNativeAdvisorPool } from "../../native-runtime/catalog-registry"
import type { NativeModelRef } from "../../native-routing/types"

type EnvSnapshot = {
  readonly OPENCODE_TEST_HOME: string | undefined
  readonly OCX_PROFILE: string | undefined
  readonly OMO_PROFILE: string | undefined
  readonly OPENCODE_CONFIG_DIR: string | undefined
  readonly XDG_DATA_HOME: string | undefined
}

const originalEnv: EnvSnapshot = {
  OPENCODE_TEST_HOME: process.env.OPENCODE_TEST_HOME,
  OCX_PROFILE: process.env.OCX_PROFILE,
  OMO_PROFILE: process.env.OMO_PROFILE,
  OPENCODE_CONFIG_DIR: process.env.OPENCODE_CONFIG_DIR,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
}

const tempDirs: string[] = []

function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `omo-v2-tui-index-${label}-`))
  tempDirs.push(dir)
  return dir
}

function isolateEnv(testHome: string, dataHome: string): void {
  process.env.OPENCODE_TEST_HOME = testHome
  process.env.XDG_DATA_HOME = dataHome
  delete process.env.OCX_PROFILE
  delete process.env.OMO_PROFILE
  delete process.env.OPENCODE_CONFIG_DIR
}

function restoreEnv(): void {
  for (const key of ["OPENCODE_TEST_HOME", "OCX_PROFILE", "OMO_PROFILE", "OPENCODE_CONFIG_DIR", "XDG_DATA_HOME"] as const) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

beforeEach(() => {
  tempDirs.length = 0
})

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  restoreEnv()
})

describe("#given the V2 TUI plugin module", () => {
  it("#when imported #then it default-exports a Plugin.define definition with id and setup", () => {
    expect(tuiModule.id).toBe("oh-my-openagent:tui")
    expect(typeof tuiModule.setup).toBe("function")
  })
})

describe("#given a setup that does not load a second Solid runtime", () => {
  it("#when setup runs #then it registers controls through the native V2 context", async () => {
    const fake = createFakeV2TuiContext()
    const setup = createV2TuiSetup({ registerTaskSidebar: async () => () => undefined, getAdvisorPool: () => ({ read: () => [], write: () => undefined }) })

    const cleanup = await setup(fake.ctx)

    expect(typeof cleanup).toBe("function")
    expect(fake.slotClaims).toHaveLength(0)
    expect(fake.keymapLayers).toHaveLength(1)
    cleanup?.()
  })

  it("#when the server catalog RPC fails #then the slash command reports the error in a toast", async () => {
    const fake = createFakeV2TuiContext({ directory: "/fake/project" })
    fake.ctx.client.rpc.call = async () => { throw new Error("server is offline") }
    const setup = createV2TuiSetup({ registerTaskSidebar: async () => () => undefined, getAdvisorPool: () => ({ read: () => [], write: () => undefined }) })

    await setup(fake.ctx)
    const pool = fake.keymapLayers[0]?.().commands?.find((command) => command.id === "omo.native.pool")
    await pool?.run?.()

    expect(fake.toasts).toEqual([{
      title: "Model pool unavailable",
      message: "server is offline",
      variant: "error",
    }])
  })
})

describe("#given a setup with isolated catalog and advisor controls", () => {
  it("#when setup runs #then only native pool, providers, and advisor-pool controls register", async () => {
    const testHome = makeTempDir("test-home")
    const dataHome = makeTempDir("data")
    const project = makeTempDir("project")
    isolateEnv(testHome, dataHome)

    const model = { providerID: "fixture", id: "free", available: true }
    const snapshot = {
      fetchedAt: "2026-10-12T00:00:00.000Z",
      connectedProviders: ["fixture"],
      models: [model],
      sources: {},
      transportModelIDs: {},
      unregisteredLiveModels: {},
      unavailableProviders: {},
    }
    const fake = createFakeV2TuiContext({ directory: project, rpcOutput: { snapshot, providerIDs: ["fixture"] } })
    const advisorModels: NativeModelRef[] = []
    const unregisterAdvisor = registerNativeAdvisorPool(project, {
      read: () => advisorModels,
      write: (models) => { advisorModels.splice(0, advisorModels.length, ...models) },
    })
    const setup = createV2TuiSetup({ registerTaskSidebar: async () => () => undefined })

    const cleanup = await setup(fake.ctx)
    expect(typeof cleanup).toBe("function")

    const slashCommandIds: string[] = []
    const commands = []
    for (const layer of fake.keymapLayers) {
      for (const command of layer().commands ?? []) {
        if (command.id !== undefined) slashCommandIds.push(command.id)
        commands.push(command)
      }
    }
    expect(slashCommandIds).toEqual(["omo.native.pool", "omo.native.providers", "omo.native.advisor-pool"])
    const pool = commands.find((command) => command.id === "omo.native.pool")
    await pool?.run?.()
    expect(fake.clientRpcCalls).toEqual([{
      rpcID: "momo.native", method: "catalogSnapshot", location: { directory: project }, input: {},
    }])

    expect(fake.keymapLayers.map((layer) => layer().mode)).toEqual(["global"])

    cleanup?.()
    unregisterAdvisor()
    expect(fake.slotClaims).toHaveLength(0)
  })
})
