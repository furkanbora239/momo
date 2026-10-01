import { isRecord } from "@oh-my-opencode/utils"
import { readFileSync, statSync } from "node:fs"
import * as path from "node:path"

import { getDataDir } from "./data-path"
import { log } from "./logger"

/**
 * Reads OpenCode's auth.json to detect the auth type used by a provider.
 *
 * OpenCode stores auth credentials at `<dataDir>/opencode/auth.json` in the
 * shape `{ [providerID]: { type: "oauth" | "api" | "wellknown", ... } }`.
 *
 * The file is read with mtime-based caching so we do not stat/parse it on
 * every chat.params invocation.
 */

type AuthRecord = {
  type?: unknown
  key?: unknown
}

type AuthCacheEntry = {
  mtimeMs: number
  map: Map<string, string>
  keyMap: Map<string, string>
}

let cached: AuthCacheEntry | null = null

function getAuthFilePath(): string {
  return path.join(getDataDir(), "opencode", "auth.json")
}

function loadAuthMap(): Map<string, string> {
  loadAuthStore()
  return cached?.map ?? new Map()
}

// Reads a provider API key from OpenCode's auth.json (e.g. Zen key under
// `opencode-go`). Read on demand; never log or persist the returned value.
export function getProviderApiKey(providerID: string): string | undefined {
  loadAuthStore()
  if (!cached) return undefined
  return cached.keyMap.get(providerID)
}

function loadAuthStore(): void {
  const filePath = getAuthFilePath()

  let mtimeMs: number
  try {
    mtimeMs = statSync(filePath).mtimeMs
  } catch (error) {
    if (error instanceof Error) {
      cached = null
      return
    }

    cached = null
    return
  }

  if (cached && cached.mtimeMs === mtimeMs) {
    return
  }

  try {
    const raw = readFileSync(filePath, "utf-8")
    const parsed: unknown = JSON.parse(raw)
    const map = new Map<string, string>()
    const keyMap = new Map<string, string>()
    if (isRecord(parsed)) {
      for (const [providerId, entry] of Object.entries(parsed)) {
        if (!isRecord(entry)) continue
        const type = entry.type
        if (typeof type === "string") {
          map.set(providerId, type)
        }
        const key = entry.key
        if (typeof key === "string" && key.length > 0) {
          keyMap.set(providerId, key)
        }
      }
    }
    cached = { mtimeMs, map, keyMap }
  } catch (error) {
    log("[opencode-provider-auth] Failed to read auth.json", {
      error: error instanceof Error ? error.message : String(error),
    })
    cached = null
  }
}

export function getProviderAuthType(providerID: string): string | undefined {
  return loadAuthMap().get(providerID)
}

export function isProviderUsingOAuth(providerID: string): boolean {
  return getProviderAuthType(providerID) === "oauth"
}

export function _resetProviderAuthCacheForTesting(): void {
  cached = null
}
