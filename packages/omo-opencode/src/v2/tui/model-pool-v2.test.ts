import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { type ModelPool } from "../../shared/model-pool"
import type { PoolCatalogRow } from "../../features/model-pool/pool-catalog-rows"
import {
  createFakeSolidRuntime,
  createFakeV2TuiContext,
  flushTimeoutZero,
  type FakeSolidNode,
} from "./fake-tui-context"
import { createV2TuiFacade } from "./tui-facade"

const CARD_MODE = "omo.tui-card.pool"

type ModelPoolV2Module = typeof import("./model-pool-v2")

async function importFreshModelPoolV2(): Promise<ModelPoolV2Module> {
  return await import(
    new URL(
      `./model-pool-v2.ts?model-pool-v2-test=${Date.now()}-${Math.random()}`,
      import.meta.url,
    ).href
  )
}

type EnvSnapshot = {
  readonly HOME: string | undefined
  readonly XDG_CACHE_HOME: string | undefined
  readonly XDG_DATA_HOME: string | undefined
}

const originalEnv: EnvSnapshot = {
  HOME: process.env.HOME,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
}

const tempDirs: string[] = []

function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `omo-v2-tui-pool-${label}-`))
  tempDirs.push(dir)
  return dir
}

function restoreEnv(): void {
  for (const key of ["HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME"] as const) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function rowsFixture(): PoolCatalogRow[] {
  return [
    { providerID: "provider-a", modelID: "model-one", inputPerM: undefined, outputPerM: undefined, costTier: undefined },
    { providerID: "provider-a", modelID: "model-two", inputPerM: undefined, outputPerM: undefined, costTier: undefined },
    { providerID: "provider-b", modelID: "model-three", inputPerM: undefined, outputPerM: undefined, costTier: undefined },
  ]
}

function seedProviderModelsCache(cacheHome: string): void {
  const cacheDir = join(cacheHome, "oh-my-opencode")
  mkdirSync(cacheDir, { recursive: true })
  writeFileSync(
    join(cacheDir, "provider-models.json"),
    JSON.stringify({
      models: {
        "provider-a": ["model-one", "model-two"],
        "provider-b": ["model-three"],
      },
      connected: ["provider-a", "provider-b"],
      updatedAt: new Date().toISOString(),
    }),
  )
}

function findTextContent(node: FakeSolidNode, needle: string): boolean {
  if (typeof node.props.content === "string" && node.props.content.includes(needle)) {
    return true
  }
  for (const child of node.children) {
    if (child !== null && typeof child === "object" && "props" in child) {
      if (findTextContent(child as FakeSolidNode, needle)) return true
    }
  }
  return false
}

function slashCommandOf(
  fake: ReturnType<typeof createFakeV2TuiContext>,
  id: string,
): { readonly slash?: { readonly name: string }; readonly run: () => void } | undefined {
  for (const layer of fake.keymapLayers) {
    for (const command of layer().commands ?? []) {
      if (command.id === id) return command
    }
  }
  return undefined
}

function cardLayerCommands(
  fake: ReturnType<typeof createFakeV2TuiContext>,
): { readonly bind?: false | string; readonly run: (input?: string) => unknown }[] {
  for (const layer of fake.keymapLayers) {
    const resolved = layer()
    if (resolved.mode === CARD_MODE) return resolved.commands ?? []
  }
  return []
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

describe("#given poolAfterToggle with an empty pool", () => {
  it("#when excluding an allowed model #then the full catalog minus that entry is materialized", async () => {
    const { poolAfterToggle } = await importFreshModelPoolV2()
    const empty: ModelPool = { version: 1, allowed: [], updatedAt: "" }
    const rows = rowsFixture()

    const next = poolAfterToggle(empty, rows, "provider-a", "model-one")

    expect(next.allowed).toEqual([
      { providerID: "provider-a", modelID: "model-two" },
      { providerID: "provider-b", modelID: "model-three" },
    ])
  })

  it("#when the pool already excludes entries #then the entry toggles back in", async () => {
    const { poolAfterToggle } = await importFreshModelPoolV2()
    const pool: ModelPool = {
      version: 1,
      allowed: [{ providerID: "provider-a", modelID: "model-two" }],
      updatedAt: "",
    }
    const rows = rowsFixture()

    const next = poolAfterToggle(pool, rows, "provider-a", "model-one")

    expect(next.allowed).toEqual([
      { providerID: "provider-a", modelID: "model-two" },
      { providerID: "provider-a", modelID: "model-one" },
    ])
  })
})

describe("#given a registered V2 model pool without a catalog cache", () => {
  it("#when the pool command runs #then a warning toast is shown", async () => {
    const home = makeTempDir("home")
    const cacheHome = makeTempDir("cache")
    process.env.HOME = home
    process.env.XDG_CACHE_HOME = cacheHome
    const { registerModelPoolV2 } = await importFreshModelPoolV2()

    const fake = createFakeV2TuiContext({ directory: join(home, "project") })
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()
    registerModelPoolV2(fake.ctx, facade, solid)

    slashCommandOf(fake, "omo.model-pool.pool")?.run()

    expect(fake.toasts).toHaveLength(1)
    expect(fake.toasts[0]?.variant).toBe("warning")
    expect(fake.dialogShows).toHaveLength(0)
  })
})

describe("#given a registered V2 model pool with a catalog cache", () => {
  it("#when the pool command runs #then the dialog renders the catalog cards", async () => {
    const home = makeTempDir("home-open")
    const cacheHome = makeTempDir("cache-open")
    process.env.HOME = home
    process.env.XDG_CACHE_HOME = cacheHome
    seedProviderModelsCache(cacheHome)
    const { registerModelPoolV2 } = await importFreshModelPoolV2()

    const fake = createFakeV2TuiContext({ directory: join(home, "project") })
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()
    registerModelPoolV2(fake.ctx, facade, solid)

    slashCommandOf(fake, "omo.model-pool.pool")?.run()
    await flushTimeoutZero()

    expect(fake.dialogShows).toHaveLength(1)
    expect(fake.dialogSizes).toEqual(["xlarge"])
    expect(fake.pushedModes).toEqual([CARD_MODE])
    const rendered = fake.dialogShows[0]?.render() as FakeSolidNode
    expect(findTextContent(rendered, "model-one")).toBe(true)
    expect(findTextContent(rendered, "model-three")).toBe(true)
  })

  it("#when enter activates the focused card #then the model is excluded and the pool file is written", async () => {
    const home = makeTempDir("home-toggle")
    const cacheHome = makeTempDir("cache-toggle")
    process.env.HOME = home
    process.env.XDG_CACHE_HOME = cacheHome
    seedProviderModelsCache(cacheHome)
    const { registerModelPoolV2 } = await importFreshModelPoolV2()

    const fake = createFakeV2TuiContext({ directory: join(home, "project") })
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()
    registerModelPoolV2(fake.ctx, facade, solid)

    slashCommandOf(fake, "omo.model-pool.pool")?.run()
    await flushTimeoutZero()
    for (const command of cardLayerCommands(fake)) {
      if (command.bind === "enter") command.run()
    }
    await flushTimeoutZero()

    const poolPath = join(home, ".omo", "model-pool.json")
    expect(existsSync(poolPath)).toBe(true)
    const written = JSON.parse(readFileSync(poolPath, "utf-8")) as ModelPool
    expect(written.allowed).toEqual([
      { providerID: "provider-a", modelID: "model-two" },
      { providerID: "provider-b", modelID: "model-three" },
    ])
    expect(fake.toasts.at(-1)?.message).toContain("excluded")
    expect(JSON.parse(readFileSync(poolPath, "utf-8")).allowed).toEqual(written.allowed)
  })

  it("#when the alt+c clear binding runs #then the pool is emptied", async () => {
    const home = makeTempDir("home-clear")
    const cacheHome = makeTempDir("cache-clear")
    process.env.HOME = home
    process.env.XDG_CACHE_HOME = cacheHome
    seedProviderModelsCache(cacheHome)
    const { registerModelPoolV2 } = await importFreshModelPoolV2()

    const fake = createFakeV2TuiContext({ directory: join(home, "project") })
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()
    registerModelPoolV2(fake.ctx, facade, solid)

    slashCommandOf(fake, "omo.model-pool.pool")?.run()
    await flushTimeoutZero()
    for (const command of cardLayerCommands(fake)) {
      if (command.bind === "alt+c") command.run()
    }

    const poolPath = join(home, ".omo", "model-pool.json")
    const written = JSON.parse(readFileSync(poolPath, "utf-8")) as ModelPool
    expect(written.allowed).toEqual([])
    expect(fake.toasts.at(-1)?.message).toContain("cleared")
  })
})
