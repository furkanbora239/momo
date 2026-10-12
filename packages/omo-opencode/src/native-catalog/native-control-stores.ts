import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { ModelPool } from "../shared/model-pool"
import type { ProviderToggles } from "../shared/provider-toggles"
import { resolveNativeOmoDirectory } from "./paths"

export class NativeControlStoreError extends Error {
  constructor(readonly path: string, message: string, options?: ErrorOptions) {
    super(`Native routing control store ${path}: ${message}`, options)
    this.name = "NativeControlStoreError"
  }
}

function parsePool(value: unknown, path: string): ModelPool {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.allowed)) {
    throw new NativeControlStoreError(path, "invalid model pool schema")
  }
  const allowed = value.allowed.map((entry) => {
    if (!isRecord(entry) || typeof entry.providerID !== "string" || !entry.providerID || typeof entry.modelID !== "string" || !entry.modelID || (entry.preferred !== undefined && typeof entry.preferred !== "boolean")) {
      throw new NativeControlStoreError(path, "invalid model pool entry")
    }
    return entry.preferred === undefined
      ? { providerID: entry.providerID, modelID: entry.modelID }
      : { providerID: entry.providerID, modelID: entry.modelID, preferred: entry.preferred }
  })
  return { version: 1, allowed, updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "" }
}

function parseToggles(value: unknown, path: string): ProviderToggles {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.disabled) || !value.disabled.every((entry) => typeof entry === "string" && entry.length > 0)) {
    throw new NativeControlStoreError(path, "invalid provider toggle schema")
  }
  return { version: 1, disabled: value.disabled, updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : "" }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readJson(path: string): unknown | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw new NativeControlStoreError(path, "cannot read or parse file", { cause: error })
  }
}

function atomicWrite(path: string, value: unknown): void {
  const directory = dirname(path)
  const temporary = join(directory, `.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`)
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" })
    renameSync(temporary, path)
  } catch (error) {
    throw new NativeControlStoreError(path, "cannot write atomically", { cause: error })
  }
}

export function createNativeControlStores(homeDirectory?: string) {
  const directory = resolveNativeOmoDirectory(homeDirectory)
  const poolPath = join(directory, "model-pool.json")
  const togglesPath = join(directory, "provider-toggles.json")
  return {
    readPool(): ModelPool {
      const value = readJson(poolPath)
      return value === undefined ? { version: 1, allowed: [], updatedAt: "" } : parsePool(value, poolPath)
    },
    writePool(value: ModelPool): void { atomicWrite(poolPath, parsePool(value, poolPath)) },
    readProviderToggles(): ProviderToggles {
      const value = readJson(togglesPath)
      return value === undefined ? { version: 1, disabled: [], updatedAt: "" } : parseToggles(value, togglesPath)
    },
    writeProviderToggles(value: ProviderToggles): void { atomicWrite(togglesPath, parseToggles(value, togglesPath)) },
  }
}
