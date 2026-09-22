import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { log } from "../../shared/logger"

export type EvrenConsent = {
  version: 1
  status: "accepted" | "declined"
  termsVersion: number
  updatedAt: string
}

export type EvrenConsentStatus = "accepted" | "declined" | "unknown"

export function resolveEvrenConsentPath(): string {
  return join(homedir(), ".omo", "evren-consent.json")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseEvrenConsent(value: unknown): EvrenConsent | null {
  if (!isRecord(value)) return null
  if (value.version !== 1) return null
  if (value.status !== "accepted" && value.status !== "declined") return null
  if (typeof value.termsVersion !== "number") return null
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : ""
  return { version: 1, status: value.status, termsVersion: value.termsVersion, updatedAt }
}

/**
 * Default record handed back when no decisive consent exists on disk.
 * "Undecided" itself is represented by the file being absent (or invalid);
 * readEvrenConsentStatus surfaces that state as "unknown".
 */
function defaultEvrenConsent(): EvrenConsent {
  return { version: 1, status: "declined", termsVersion: 0, updatedAt: new Date().toISOString() }
}

function readConsentFile(getConsentPath: () => string): EvrenConsent | null {
  const filePath = getConsentPath()
  try {
    if (!existsSync(filePath)) return null
    const raw = readFileSync(filePath, "utf-8")
    const parsed: unknown = JSON.parse(raw)
    const consent = parseEvrenConsent(parsed)
    if (consent === null) {
      log("[evren-consent] Consent file exists but failed to parse; treating as unknown", {
        path: filePath,
      })
      return null
    }
    return consent
  } catch (error) {
    log("[evren-consent] Error reading evren consent", { error: String(error) })
    return null
  }
}

export function createEvrenConsentStore(
  getConsentPath: () => string = resolveEvrenConsentPath,
) {
  function readEvrenConsent(): EvrenConsent {
    return readConsentFile(getConsentPath) ?? defaultEvrenConsent()
  }

  function writeEvrenConsent(consent: EvrenConsent): void {
    try {
      const filePath = getConsentPath()
      const directory = dirname(filePath)
      if (!existsSync(directory)) {
        mkdirSync(directory, { recursive: true })
      }
      writeFileSync(filePath, JSON.stringify(consent, null, 2))
    } catch (error) {
      log("[evren-consent] Error writing evren consent", { error: String(error) })
    }
  }

  return { readEvrenConsent, writeEvrenConsent }
}

const defaultEvrenConsentStore = createEvrenConsentStore()

export const { readEvrenConsent, writeEvrenConsent } = defaultEvrenConsentStore

/**
 * True when a valid consent record exists on disk. An absent or unparseable
 * file means the user has not made a decisive choice yet.
 */
export function hasEvrenConsent(
  getConsentPath: () => string = resolveEvrenConsentPath,
): boolean {
  return readConsentFile(getConsentPath) !== null
}

/**
 * "unknown" when the consent file is missing or unparseable; otherwise the
 * stored decision.
 */
export function readEvrenConsentStatus(
  getConsentPath: () => string = resolveEvrenConsentPath,
): EvrenConsentStatus {
  return readConsentFile(getConsentPath)?.status ?? "unknown"
}
