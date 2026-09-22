import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { log } from "../../shared/logger"
import { EVREN_BASE_URL } from "./provider"

export const EVREN_TERMS_VERSION = 1

const EVREN_TERMS_TIMEOUT_MS = 15_000

export type EvrenTermsTextResult =
  | { ok: true; text: string; version: number }
  | { ok: false; error: string }

export type EvrenAcceptResult = { ok: true } | { ok: false; error: string }

type FetchLike = typeof globalThis.fetch

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  fetchImpl: FetchLike,
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), EVREN_TERMS_TIMEOUT_MS)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Fetches the current EVREN terms text (`GET <baseUrl>/terms/text`).
 * The gateway returns `{version, doc_path, content}`. Never throws.
 */
export async function fetchEvrenTermsText(
  baseUrl: string = EVREN_BASE_URL,
  fetchImpl: FetchLike = globalThis.fetch,
): Promise<EvrenTermsTextResult> {
  try {
    const response = await fetchWithTimeout(`${baseUrl}/terms/text`, {
      method: "GET",
      headers: { Accept: "application/json" },
    }, fetchImpl)
    if (!response.ok) {
      return { ok: false, error: `EVREN terms request failed with HTTP ${response.status}` }
    }
    const payload: unknown = await response.json()
    if (!isRecord(payload)) {
      return { ok: false, error: "EVREN terms response is not a JSON object" }
    }
    if (typeof payload.version !== "number" || typeof payload.content !== "string") {
      return { ok: false, error: "EVREN terms response has invalid version or content" }
    }
    return { ok: true, text: payload.content, version: payload.version }
  } catch (error) {
    return { ok: false, error: `EVREN terms request error: ${errorMessage(error)}` }
  }
}

/**
 * Accepts EVREN terms (`POST <baseUrl>/terms/accept` with body
 * `{"version": <version>}` and a Bearer API key). Never throws.
 */
export async function acceptEvrenTerms(params: {
  baseUrl?: string
  apiKey: string
  version?: number
  fetchImpl?: FetchLike
}): Promise<EvrenAcceptResult> {
  const baseUrl = params.baseUrl ?? EVREN_BASE_URL
  const version = params.version ?? EVREN_TERMS_VERSION
  const fetchImpl = params.fetchImpl ?? globalThis.fetch
  try {
    const response = await fetchWithTimeout(`${baseUrl}/terms/accept`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ version }),
    }, fetchImpl)
    if (!response.ok) {
      return { ok: false, error: `EVREN terms accept failed with HTTP ${response.status}` }
    }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: `EVREN terms accept error: ${errorMessage(error)}` }
  }
}

/**
 * Candidate OpenCode auth.json locations, most authoritative first. OpenCode
 * resolves its data dir from XDG; on macOS the install may also live under
 * Application Support, and both have been observed, so probe each.
 */
function resolveOpenCodeAuthPaths(): string[] {
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share")
  const candidates = [join(dataHome, "opencode", "auth.json")]
  if (process.platform === "darwin") {
    candidates.push(join(homedir(), "Library", "Application Support", "opencode", "auth.json"))
  }
  return candidates
}

function readApiKeyFromAuthFile(filePath: string): string | undefined {
  try {
    const raw = readFileSync(filePath, "utf-8")
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return undefined
    const evren = parsed["evren"]
    if (!isRecord(evren)) return undefined
    if (evren["type"] !== "api") return undefined
    const key = evren["key"]
    if (typeof key !== "string" || key.length === 0) return undefined
    return key
  } catch {
    return undefined
  }
}

function readApiKeyFromOpenCodeAuth(): string | undefined {
  for (const candidate of resolveOpenCodeAuthPaths()) {
    const key = readApiKeyFromAuthFile(candidate)
    if (key !== undefined) return key
  }
  return undefined
}

/**
 * Resolves the EVREN API key: `EVREN_API_KEY` env first, then OpenCode's
 * auth.json `evren` entry (`{ type: "api", key }`). Never throws.
 */
export function readEvrenApiKey(): string | undefined {
  const envKey = process.env.EVREN_API_KEY
  if (typeof envKey === "string" && envKey.length > 0) {
    return envKey
  }
  return readApiKeyFromOpenCodeAuth()
}
