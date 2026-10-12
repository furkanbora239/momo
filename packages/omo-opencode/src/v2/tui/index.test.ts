import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import tuiModule, { createV2TuiSetup } from "./index"
import {
  createFakeSolidRuntime,
  createFakeV2TuiContext,
} from "./fake-tui-context"
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

describe("#given a setup whose solid runtime is unavailable", () => {
  it("#when setup runs #then it degrades to a no-op without registering anything", async () => {
    const fake = createFakeV2TuiContext()
    const setup = createV2TuiSetup({ loadSolid: async () => null })

    const cleanup = await setup(fake.ctx)

    expect(cleanup).toBeUndefined()
    expect(fake.slotClaims).toHaveLength(0)
    expect(fake.keymapLayers).toHaveLength(0)
    expect(fake.toasts).toHaveLength(0)
  })
})

describe("#given a setup with a solid runtime and an isolated environment", () => {
  it("#when setup runs #then only native pool, providers, and advisor-pool controls register", async () => {
    const testHome = makeTempDir("test-home")
    const dataHome = makeTempDir("data")
    const project = makeTempDir("project")
    isolateEnv(testHome, dataHome)

    const solid = createFakeSolidRuntime()
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
    const setup = createV2TuiSetup({ loadSolid: async () => solid })

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

    const cardModes = fake.keymapLayers
      .map((layer) => layer().mode)
      .filter((mode): mode is string => mode !== undefined)
    expect(cardModes).toEqual([
      "omo.native-tui.model-pool",
      "omo.native-tui.providers",
      "omo.native-tui.advisor-pool",
      "global",
    ])

    cleanup?.()
    unregisterAdvisor()
    expect(fake.slotClaims).toHaveLength(4)
    expect(fake.slotClaims.every((record) => {
      const claim = record.claim as unknown as { append: string }
      return claim.append === "app"
    })).toBe(true)
  })
})
