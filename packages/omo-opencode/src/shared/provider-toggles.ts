import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { log } from "./logger"

export type ProviderToggles = {
  version: 1
  disabled: string[]
  updatedAt: string
}

export function resolveProviderTogglesPath(): string {
  return join(homedir(), ".omo", "provider-toggles.json")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseProviderToggles(value: unknown): ProviderToggles | null {
  if (!isRecord(value)) return null
  if (value.version !== 1) return null
  if (!Array.isArray(value.disabled)) return null
  const disabled: string[] = []
  for (const entry of value.disabled) {
    if (typeof entry !== "string") return null
    disabled.push(entry)
  }
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : ""
  return { version: 1, disabled, updatedAt }
}

function emptyToggles(): ProviderToggles {
  return { version: 1, disabled: [], updatedAt: new Date().toISOString() }
}

export function createProviderTogglesStore(
  getTogglesPath: () => string = resolveProviderTogglesPath,
) {
  function readProviderToggles(): ProviderToggles {
    try {
      const raw = readFileSync(getTogglesPath(), "utf-8")
      const parsed: unknown = JSON.parse(raw)
      const toggles = parseProviderToggles(parsed)
      if (toggles === null) {
        log("[provider-toggles] Provider toggles file exists but failed to parse; falling back to empty store", {
          path: getTogglesPath(),
        })
        return emptyToggles()
      }
      return toggles
    } catch (error) {
      log("[provider-toggles] Error reading provider toggles", { error: String(error) })
      return emptyToggles()
    }
  }

  function writeProviderToggles(toggles: ProviderToggles): void {
    try {
      const filePath = getTogglesPath()
      const directory = dirname(filePath)
      if (!existsSync(directory)) {
        mkdirSync(directory, { recursive: true })
      }
      writeFileSync(filePath, JSON.stringify(toggles, null, 2))
    } catch (error) {
      log("[provider-toggles] Error writing provider toggles", { error: String(error) })
    }
  }

  return { readProviderToggles, writeProviderToggles }
}

const defaultProviderTogglesStore = createProviderTogglesStore()

export const { readProviderToggles, writeProviderToggles } = defaultProviderTogglesStore

function normalizeProviderID(providerID: string): string {
  return providerID.trim().toLowerCase()
}

/**
 * A provider is disabled when its normalized id appears in the disabled list.
 * Comparison is case-insensitive and trims surrounding whitespace.
 */
export function isProviderDisabled(
  toggles: ProviderToggles,
  providerID: string,
): boolean {
  const normalized = normalizeProviderID(providerID)
  return toggles.disabled.some((entry) => normalizeProviderID(entry) === normalized)
}

/**
 * Pure add/remove. Never touches the filesystem; callers persist the
 * returned toggles via writeProviderToggles when they want the change stored.
 */
export function setProviderDisabled(
  toggles: ProviderToggles,
  providerID: string,
  disabled: boolean,
): ProviderToggles {
  const normalized = normalizeProviderID(providerID)
  const alreadyDisabled = isProviderDisabled(toggles, providerID)
  let next: string[]
  if (disabled && !alreadyDisabled) {
    next = [...toggles.disabled, normalized]
  } else if (!disabled && alreadyDisabled) {
    next = toggles.disabled.filter((entry) => normalizeProviderID(entry) !== normalized)
  } else {
    next = [...toggles.disabled]
  }
  return { version: 1, disabled: next, updatedAt: new Date().toISOString() }
}
