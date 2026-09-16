import { afterEach, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import * as logger from "./logger"
import {
  createProviderTogglesStore,
  isProviderDisabled,
  setProviderDisabled,
  type ProviderToggles,
} from "./provider-toggles"

const tempDirs: string[] = []

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "provider-toggles-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function togglesWith(...disabled: string[]): ProviderToggles {
  return {
    version: 1,
    disabled,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function createStoreInTempDir() {
  const dir = createTempDir()
  const togglesPath = join(dir, "nested", "provider-toggles.json")
  return { store: createProviderTogglesStore(() => togglesPath), togglesPath }
}

describe("provider toggles", () => {
  it("#given an empty store #when checking any provider #then it is not disabled", () => {
    // given
    const toggles = togglesWith()

    // when
    const disabled = isProviderDisabled(toggles, "openai")

    // then
    expect(disabled).toBe(false)
  })

  it("#given a store with a disabled provider #when checking it #then it is disabled", () => {
    // given
    const toggles = togglesWith("openai")

    // when
    const disabled = isProviderDisabled(toggles, "openai")

    // then
    expect(disabled).toBe(true)
  })

  it("#given a store with a disabled provider #when checking another provider #then it is not disabled", () => {
    // given
    const toggles = togglesWith("openai")

    // when
    const disabled = isProviderDisabled(toggles, "anthropic")

    // then
    expect(disabled).toBe(false)
  })

  it("#given a store #when checking a provider with different case #then matches case-insensitively", () => {
    // given
    const toggles = togglesWith("OpenAI")

    // when
    const disabled = isProviderDisabled(toggles, "openai")

    // then
    expect(disabled).toBe(true)
  })

  it("#given a store #when checking a provider with surrounding whitespace #then matches after trimming", () => {
    // given
    const toggles = togglesWith("openai")

    // when
    const disabled = isProviderDisabled(toggles, "  openai  ")

    // then
    expect(disabled).toBe(true)
  })

  it("#given a store #when disabling an enabled provider #then adds it normalized", () => {
    // given
    const toggles = togglesWith()

    // when
    const next = setProviderDisabled(toggles, "  OpenAI  ", true)

    // then
    expect(isProviderDisabled(next, "openai")).toBe(true)
    expect(next.disabled).toEqual(["openai"])
  })

  it("#given a store #when disabling an already-disabled provider #then keeps a single entry", () => {
    // given
    const toggles = togglesWith("openai")

    // when
    const next = setProviderDisabled(toggles, "openai", true)

    // then
    expect(next.disabled).toEqual(["openai"])
  })

  it("#given a store #when re-enabling a disabled provider #then removes it", () => {
    // given
    const toggles = togglesWith("openai", "google")

    // when
    const next = setProviderDisabled(toggles, "openai", false)

    // then
    expect(isProviderDisabled(next, "openai")).toBe(false)
    expect(next.disabled).toEqual(["google"])
  })

  it("#given a store #when re-enabling a non-disabled provider #then leaves the list unchanged", () => {
    // given
    const toggles = togglesWith("openai")

    // when
    const next = setProviderDisabled(toggles, "anthropic", false)

    // then
    expect(next.disabled).toEqual(["openai"])
  })

  it("#given a missing toggles file #when reading #then returns an empty store", () => {
    // given
    const { store } = createStoreInTempDir()

    // when
    const toggles = store.readProviderToggles()

    // then
    expect(toggles.version).toBe(1)
    expect(toggles.disabled).toEqual([])
    expect(Number.isNaN(Date.parse(toggles.updatedAt))).toBe(false)
  })

  it("#given a corrupt toggles file #when reading #then returns an empty store", () => {
    // given
    const { store, togglesPath } = createStoreInTempDir()
    mkdirSync(dirname(togglesPath), { recursive: true })
    writeFileSync(togglesPath, "{not-json", "utf-8")

    // when
    const toggles = store.readProviderToggles()

    // then
    expect(toggles.version).toBe(1)
    expect(toggles.disabled).toEqual([])
  })

  it("#given a toggles file with a wrong shape #when reading #then returns an empty store", () => {
    // given
    const { store, togglesPath } = createStoreInTempDir()
    mkdirSync(dirname(togglesPath), { recursive: true })
    writeFileSync(
      togglesPath,
      JSON.stringify({ version: 2, disabled: [] }),
      "utf-8",
    )

    // when
    const toggles = store.readProviderToggles()

    // then
    expect(toggles.disabled).toEqual([])
  })

  it("#given a toggles file #when reading #then parses and enforces its entries", () => {
    // given
    const { store, togglesPath } = createStoreInTempDir()
    mkdirSync(dirname(togglesPath), { recursive: true })
    writeFileSync(
      togglesPath,
      JSON.stringify({
        version: 1,
        disabled: ["openai"],
      }),
      "utf-8",
    )

    // when
    const toggles = store.readProviderToggles()

    // then
    expect(toggles.disabled).toEqual(["openai"])
    expect(isProviderDisabled(toggles, "openai")).toBe(true)
    expect(isProviderDisabled(toggles, "anthropic")).toBe(false)
  })

  it("#given a corrupt toggles file #when reading #then returns an empty store and logs a warning", async () => {
    // given
    const logSpy = spyOn(logger, "log").mockImplementation(() => {})
    const { createProviderTogglesStore: freshCreate } = await import(
      `./provider-toggles?invalid=${Date.now()}-${Math.random()}`
    )
    const dir = createTempDir()
    const togglesPath = join(dir, "provider-toggles.json")
    mkdirSync(dirname(togglesPath), { recursive: true })
    writeFileSync(togglesPath, "{not-json", "utf-8")
    const store = freshCreate(() => togglesPath)

    // when
    const toggles = store.readProviderToggles()

    // then
    expect(toggles.disabled).toEqual([])
    expect(logSpy).toHaveBeenCalled()
    logSpy.mockRestore()
  })

  it("#given a store #when writing then reading #then round-trips the disabled list", () => {
    // given
    const { store, togglesPath } = createStoreInTempDir()

    // when
    store.writeProviderToggles(togglesWith("openai", "google"))
    const toggles = store.readProviderToggles()

    // then
    expect(toggles.disabled).toEqual(["openai", "google"])
  })
})
