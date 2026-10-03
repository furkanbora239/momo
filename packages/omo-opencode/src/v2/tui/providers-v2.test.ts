import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { ProviderToggles } from "../../shared/provider-toggles"
import {
  createFakeSolidRuntime,
  createFakeV2TuiContext,
  flushTimeoutZero,
} from "./fake-tui-context"
import { createV2TuiFacade } from "./tui-facade"

type ProvidersV2Module = typeof import("./providers-v2")

async function importFreshProvidersV2(): Promise<ProvidersV2Module> {
  return await import(
    new URL(
      `./providers-v2.ts?providers-v2-test=${Date.now()}-${Math.random()}`,
      import.meta.url,
    ).href
  )
}

const tempDirs: string[] = []

function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `omo-v2-tui-providers-${label}-`))
  tempDirs.push(dir)
  return dir
}

const originalEnv = {
  HOME: process.env.HOME,
  XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
}

function restoreEnv(): void {
  for (const key of ["HOME", "XDG_CACHE_HOME"] as const) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
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

function writeToggles(home: string, disabled: string[]): void {
  const togglesPath = join(home, ".omo", "provider-toggles.json")
  mkdirSync(join(home, ".omo"), { recursive: true })
  const toggles: ProviderToggles = {
    version: 1,
    disabled,
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(togglesPath, JSON.stringify(toggles))
}

function readToggles(home: string): ProviderToggles {
  const togglesPath = join(home, ".omo", "provider-toggles.json")
  return JSON.parse(readFileSync(togglesPath, "utf-8")) as ProviderToggles
}

function slashCommandOf(
  fake: ReturnType<typeof createFakeV2TuiContext>,
  id: string,
): { readonly slash?: { readonly name: string; readonly aliases?: readonly string[] }; readonly run: () => void } | undefined {
  for (const layer of fake.keymapLayers) {
    for (const command of layer().commands ?? []) {
      if (command.id === id) return command
    }
  }
  return undefined
}

function enterBinding(
  fake: ReturnType<typeof createFakeV2TuiContext>,
): (() => unknown) | undefined {
  for (const layer of fake.keymapLayers) {
    const input = layer()
    if (input.mode !== "omo.tui-card.providers") continue
    for (const command of input.commands ?? []) {
      if (command.bind === "enter") return command.run
    }
  }
  return undefined
}

async function setupPanel(): Promise<{
  fake: ReturnType<typeof createFakeV2TuiContext>
  open: () => Promise<void>
}> {
  const fake = createFakeV2TuiContext()
  const facade = createV2TuiFacade(fake.ctx)
  const solid = createFakeSolidRuntime()
  const { registerProvidersV2 } = await importFreshProvidersV2()
  registerProvidersV2(fake.ctx, facade, solid)
  return {
    fake,
    open: async () => {
      slashCommandOf(fake, "omo.providers.slash")?.run()
      await flushTimeoutZero()
    },
  }
}

describe("registerProvidersV2", () => {
  beforeEach(() => {
    process.env.HOME = makeTempDir("home")
    process.env.XDG_CACHE_HOME = makeTempDir("cache")
    seedProviderModelsCache(process.env.XDG_CACHE_HOME)
  })

  afterEach(() => {
    restoreEnv()
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("#given a registered providers panel #when the slash command runs #then the dialog renders provider cards", async () => {
    writeToggles(process.env.HOME, ["provider-a"])
    const { fake, open } = await setupPanel()

    await open()

    expect(fake.dialogShows).toHaveLength(1)
    expect(fake.dialogSizes).toEqual(["xlarge"])
  })

  it("#given a disabled provider focused #when enter activates #then the provider is enabled on disk and a toast reports it", async () => {
    writeToggles(process.env.HOME, ["provider-a"])
    const { fake, open } = await setupPanel()

    await open()
    enterBinding(fake)?.()
    await flushTimeoutZero()

    expect(readToggles(process.env.HOME).disabled).toEqual([])
    expect(fake.toasts.at(-1)?.message).toContain("provider provider-a enabled")
  })

  it("#given every provider enabled #when enter activates #then the provider is disabled on disk", async () => {
    const { fake, open } = await setupPanel()

    await open()
    enterBinding(fake)?.()
    await flushTimeoutZero()

    const stored = readToggles(process.env.HOME)
    expect(stored.disabled).toContain("provider-a")
    expect(fake.toasts.at(-1)?.message).toContain("provider provider-a disabled")
  })

  it("#given the slash command list #then the providers command carries the provider alias", async () => {
    const { fake } = await setupPanel()

    const command = slashCommandOf(fake, "omo.providers.slash")
    expect(command?.slash?.name).toBe("providers")
    expect(command?.slash?.aliases).toContain("provider")
  })

  it("#given no cache and no toggles #when the slash command runs #then no dialog opens and an info toast explains", async () => {
    rmSync(join(process.env.XDG_CACHE_HOME, "oh-my-opencode", "provider-models.json"))
    const { fake, open } = await setupPanel()

    await open()

    expect(fake.dialogShows).toHaveLength(0)
    expect(fake.toasts.at(-1)?.message).toContain("No connected providers yet")
  })
})
