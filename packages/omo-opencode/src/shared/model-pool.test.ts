import { afterEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join } from "node:path"

import {
  createModelPoolStore,
  isModelAllowed,
  isModelPreferred,
  toggleModelInPool,
  type ModelPool,
} from "./model-pool"

const tempDirs: string[] = []

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "model-pool-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function poolWith(...entries: ModelPool["allowed"]): ModelPool {
  return {
    version: 1,
    allowed: entries,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function createStoreInTempDir() {
  const dir = createTempDir()
  const poolPath = join(dir, "nested", "model-pool.json")
  return { store: createModelPoolStore(() => poolPath), poolPath }
}

describe("model pool", () => {
  it("#given an empty pool #when checking any model #then allows it", () => {
    // given
    const pool = poolWith()

    // when
    const allowed = isModelAllowed(pool, "openai", "gpt-5.6")

    // then
    expect(allowed).toBe(true)
  })

  it("#given a non-empty pool #when checking an unlisted model #then denies it", () => {
    // given
    const pool = poolWith({ providerID: "openai", modelID: "gpt-5.6" })

    // when
    const allowed = isModelAllowed(pool, "anthropic", "claude-opus-5")

    // then
    expect(allowed).toBe(false)
  })

  it("#given a non-empty pool #when checking a listed model #then allows it", () => {
    // given
    const pool = poolWith({ providerID: "openai", modelID: "gpt-5.6" })

    // when
    const allowed = isModelAllowed(pool, "openai", "gpt-5.6")

    // then
    expect(allowed).toBe(true)
  })

  it("#given a non-empty pool #when checking the same model on another provider #then denies it", () => {
    // given
    const pool = poolWith({ providerID: "openai", modelID: "gpt-5.6" })

    // when
    const allowed = isModelAllowed(pool, "openrouter", "gpt-5.6")

    // then
    expect(allowed).toBe(false)
  })

  it("#given a pool #when toggling an unlisted model #then adds it and flips allowed state", () => {
    // given
    const pool = poolWith({ providerID: "openai", modelID: "gpt-5.6" })

    // when
    const next = toggleModelInPool(pool, "anthropic", "claude-opus-5")

    // then
    expect(isModelAllowed(next, "anthropic", "claude-opus-5")).toBe(true)
    expect(isModelAllowed(next, "openai", "gpt-5.6")).toBe(true)
  })

  it("#given a pool #when toggling a listed model #then removes it", () => {
    // given
    const pool = poolWith({ providerID: "openai", modelID: "gpt-5.6" })

    // when
    const next = toggleModelInPool(pool, "openai", "gpt-5.6")

    // then
    expect(isModelAllowed(next, "openai", "gpt-5.6")).toBe(true)
    expect(next.allowed).toEqual([])
  })

  it("#given a pool #when toggling twice #then round-trips back to the original entries", () => {
    // given
    const pool = poolWith({ providerID: "openai", modelID: "gpt-5.6" })

    // when
    const added = toggleModelInPool(pool, "anthropic", "claude-opus-5")
    const removed = toggleModelInPool(added, "anthropic", "claude-opus-5")

    // then
    expect(removed.allowed).toEqual([{ providerID: "openai", modelID: "gpt-5.6" }])
  })

  it("#given an entry with preferred #when checking preference #then returns true only for it", () => {
    // given
    const pool = poolWith(
      { providerID: "openai", modelID: "gpt-5.6", preferred: true },
      { providerID: "anthropic", modelID: "claude-opus-5" },
    )

    // when
    const preferred = isModelPreferred(pool, "openai", "gpt-5.6")
    const plain = isModelPreferred(pool, "anthropic", "claude-opus-5")

    // then
    expect(preferred).toBe(true)
    expect(plain).toBe(false)
  })

  it("#given a missing pool file #when reading #then returns an empty pool", () => {
    // given
    const { store } = createStoreInTempDir()

    // when
    const pool = store.readModelPool()

    // then
    expect(pool.version).toBe(1)
    expect(pool.allowed).toEqual([])
    expect(Number.isNaN(Date.parse(pool.updatedAt))).toBe(false)
  })

  it("#given a corrupt pool file #when reading #then returns an empty pool", () => {
    // given
    const { store, poolPath } = createStoreInTempDir()
    mkdirSync(dirname(poolPath), { recursive: true })
    writeFileSync(poolPath, "{not-json", "utf-8")

    // when
    const pool = store.readModelPool()

    // then
    expect(pool.version).toBe(1)
    expect(pool.allowed).toEqual([])
  })

  it("#given a pool file with a wrong shape #when reading #then returns an empty pool", () => {
    // given
    const { store, poolPath } = createStoreInTempDir()
    mkdirSync(dirname(poolPath), { recursive: true })
    writeFileSync(
      poolPath,
      JSON.stringify({ version: 2, allowed: [] }),
      "utf-8",
    )

    // when
    const pool = store.readModelPool()

    // then
    expect(pool.allowed).toEqual([])
  })

  it("#given a pool #when writing then reading #then round-trips the entries", () => {
    // given
    const { store } = createStoreInTempDir()
    const pool = poolWith({ providerID: "openai", modelID: "gpt-5.6", preferred: true })

    // when
    store.writeModelPool(pool)
    const reread = store.readModelPool()

    // then
    expect(reread.allowed).toEqual([
      { providerID: "openai", modelID: "gpt-5.6", preferred: true },
    ])
  })

  it("#given a store #when writing into a missing directory #then creates it", () => {
    // given
    const { store, poolPath } = createStoreInTempDir()
    const pool = poolWith({ providerID: "openai", modelID: "gpt-5.6" })

    // when
    store.writeModelPool(pool)

    // then
    expect(basename(poolPath)).toBe("model-pool.json")
    expect(store.readModelPool().allowed).toEqual([
      { providerID: "openai", modelID: "gpt-5.6" },
    ])
  })
})
