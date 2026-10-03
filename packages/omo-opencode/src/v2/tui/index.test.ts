import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import tuiModule, { createV2TuiSetup } from "./index"
import {
  createFakeSolidRuntime,
  createFakeV2TuiContext,
  type FakeSolidNode,
} from "./fake-tui-context"
import { createV2TuiFacade } from "./tui-facade"

type EnvSnapshot = {
  readonly HOME: string | undefined
  readonly OCX_PROFILE: string | undefined
  readonly OMO_PROFILE: string | undefined
  readonly OPENCODE_CONFIG_DIR: string | undefined
  readonly XDG_DATA_HOME: string | undefined
}

const originalEnv: EnvSnapshot = {
  HOME: process.env.HOME,
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

function isolateEnv(home: string, dataHome: string): void {
  process.env.HOME = home
  process.env.XDG_DATA_HOME = dataHome
  delete process.env.OCX_PROFILE
  delete process.env.OMO_PROFILE
  delete process.env.OPENCODE_CONFIG_DIR
}

function restoreEnv(): void {
  for (const key of ["HOME", "OCX_PROFILE", "OMO_PROFILE", "OPENCODE_CONFIG_DIR", "XDG_DATA_HOME"] as const) {
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
  it("#when setup runs #then the flagship features register in priority order and cleanup unregisters them", async () => {
    const home = makeTempDir("home")
    const dataHome = makeTempDir("data")
    const project = makeTempDir("project")
    isolateEnv(home, dataHome)

    const fake = createFakeV2TuiContext({ directory: project })
    const solid = createFakeSolidRuntime()
    const setup = createV2TuiSetup({ loadSolid: async () => solid })

    const cleanup = await setup(fake.ctx)
    expect(typeof cleanup).toBe("function")

    const slashCommandIds: string[] = []
    for (const layer of fake.keymapLayers) {
      for (const command of layer().commands ?? []) {
        if (command.id !== undefined) slashCommandIds.push(command.id)
      }
    }
    expect(slashCommandIds).toEqual([
      "omo.subagent-tree.tasks",
      "omo.model-pool.pool",
      "omo.providers.slash",
    ])

    const cardModes = fake.keymapLayers
      .map((layer) => layer().mode)
      .filter((mode): mode is string => mode !== undefined)
    expect(cardModes).toContain("omo.tui-card.tasks")
    expect(cardModes).toContain("omo.tui-card.pool")

    // One sidebar.content claim (sidebar) + one app-level claim per keymap
    // layer: tasks, pool, providers panels each register an interaction
    // layer and a slash-command layer.
    expect(fake.slotClaims).toHaveLength(7)
    const sidebarClaim = fake.slotClaims.find(
      (record) =>
        (record.claim as unknown as { readonly append: string }).append ===
        "sidebar.content",
    )
    expect(sidebarClaim).toBeDefined()
    const claim = sidebarClaim?.claim as unknown as {
      readonly append: string
      readonly render: (input: { readonly sessionID: string }) => unknown
    }
    expect(claim.append).toBe("sidebar.content")
    const rendered = claim.render({ sessionID: "sess-1" }) as FakeSolidNode
    expect(rendered.tag).toBe("box")

    const appClaims = fake.slotClaims.filter(
      (record) =>
        (record.claim as unknown as { readonly append: string }).append ===
        "app",
    )
    expect(appClaims).toHaveLength(6)

    cleanup?.()
    const sidebarRecord = fake.slotClaims.find(
      (record) =>
        (record.claim as unknown as { readonly append: string }).append ===
        "sidebar.content",
    )
    expect(sidebarRecord?.unregistered).toBe(true)
  })
})
