import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { log } from "./logger"

export type ModelPoolEntry = {
  providerID: string
  modelID: string
  preferred?: boolean
}

export type ModelPool = {
  version: 1
  allowed: ModelPoolEntry[]
  updatedAt: string
}

export function resolveModelPoolPath(): string {
  return join(homedir(), ".omo", "model-pool.json")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseModelPool(value: unknown): ModelPool | null {
  if (!isRecord(value)) return null
  if (value.version !== 1) return null
  if (!Array.isArray(value.allowed)) return null
  const allowed: ModelPoolEntry[] = []
  for (const entry of value.allowed) {
    if (!isRecord(entry)) return null
    if (typeof entry.providerID !== "string" || typeof entry.modelID !== "string") {
      return null
    }
    const poolEntry: ModelPoolEntry = {
      providerID: entry.providerID,
      modelID: entry.modelID,
    }
    if (entry.preferred === true) {
      poolEntry.preferred = true
    }
    allowed.push(poolEntry)
  }
  const updatedAt =
    typeof value.updatedAt === "string" ? value.updatedAt : ""
  return { version: 1, allowed, updatedAt }
}

function emptyPool(): ModelPool {
  return { version: 1, allowed: [], updatedAt: new Date().toISOString() }
}

export function createModelPoolStore(
  getPoolPath: () => string = resolveModelPoolPath,
) {
  function readModelPool(): ModelPool {
    try {
      const raw = readFileSync(getPoolPath(), "utf-8")
      const parsed: unknown = JSON.parse(raw)
      const pool = parseModelPool(parsed)
      if (pool === null) {
        log("[model-pool] Model pool file exists but failed to parse; falling back to empty pool", {
          path: getPoolPath(),
        })
        return emptyPool()
      }
      return pool
    } catch (error) {
      log("[model-pool] Error reading model pool", { error: String(error) })
      return emptyPool()
    }
  }

  function writeModelPool(pool: ModelPool): void {
    try {
      const filePath = getPoolPath()
      const directory = dirname(filePath)
      if (!existsSync(directory)) {
        mkdirSync(directory, { recursive: true })
      }
      writeFileSync(filePath, JSON.stringify(pool, null, 2))
    } catch (error) {
      log("[model-pool] Error writing model pool", { error: String(error) })
    }
  }

  return { readModelPool, writeModelPool }
}

const defaultModelPoolStore = createModelPoolStore()

export const { readModelPool, writeModelPool } = defaultModelPoolStore

function matchesEntry(
  entry: ModelPoolEntry,
  providerID: string,
  modelID: string,
): boolean {
  return entry.providerID === providerID && entry.modelID === modelID
}

/**
 * An empty `allowed` list means "no restriction": every model is allowed.
 * This keeps the pool file backward compatible with installs that never
 * touched it.
 */
export function isModelAllowed(
  pool: ModelPool,
  providerID: string,
  modelID: string,
): boolean {
  if (pool.allowed.length === 0) return true
  return pool.allowed.some((entry) => matchesEntry(entry, providerID, modelID))
}

export function isModelPreferred(
  pool: ModelPool,
  providerID: string,
  modelID: string,
): boolean {
  return pool.allowed.some(
    (entry) =>
      entry.preferred === true && matchesEntry(entry, providerID, modelID),
  )
}

/**
 * Pure add/remove. Never touches the filesystem; callers persist the
 * returned pool via writeModelPool when they want the change stored.
 */
export function toggleModelInPool(
  pool: ModelPool,
  providerID: string,
  modelID: string,
): ModelPool {
  const allowed = isModelAllowed(pool, providerID, modelID)
    ? pool.allowed.filter((entry) => !matchesEntry(entry, providerID, modelID))
    : [...pool.allowed, { providerID, modelID }]
  return { version: 1, allowed, updatedAt: new Date().toISOString() }
}
