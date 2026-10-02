import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { isPlainRecord } from "@oh-my-opencode/utils"

import { writeFileAtomically } from "../../shared/write-file-atomically"
import { isNamedTuiPluginEntry, isServerPluginEntry } from "../doctor/checks/tui-plugin-config"
import {
  desiredTuiEntry,
  formatConfig,
  isAnyOmoTuiPluginEntry,
  readConfig,
  readServerConfig,
  type ConfigShape,
  type EnsureTuiPluginEntryResult,
} from "./add-tui-plugin-to-tui-config"

export type V2ServerEntry = {
  readonly desiredPackage: string
  readonly options?: Record<string, unknown>
}

export type CliPluginEntry = string | { readonly package: string; readonly options?: Record<string, unknown> }

export function existingServerConfigPath(configDir: string): string | null {
  const jsoncPath = join(configDir, "opencode.jsonc")
  if (existsSync(jsoncPath)) return jsoncPath

  const jsonPath = join(configDir, "opencode.json")
  if (existsSync(jsonPath)) return jsonPath

  return null
}

function entryFromV2Plugins(value: unknown): V2ServerEntry | null {
  if (!Array.isArray(value)) return null
  for (const entry of value) {
    if (typeof entry === "string" && isServerPluginEntry(entry)) {
      const desired = desiredTuiEntry(entry)
      if (desired !== null) return { desiredPackage: desired }
      continue
    }
    if (!isPlainRecord(entry) || typeof entry["package"] !== "string") continue
    if (!isServerPluginEntry(entry["package"])) continue
    const desired = desiredTuiEntry(entry["package"])
    if (desired === null) continue
    const options = entry["options"]
    return isPlainRecord(options) ? { desiredPackage: desired, options } : { desiredPackage: desired }
  }
  return null
}

function entryFromLegacyPlugin(value: unknown): V2ServerEntry | null {
  if (!Array.isArray(value)) return null
  for (const entry of value) {
    if (typeof entry !== "string" || !isServerPluginEntry(entry)) continue
    const desired = desiredTuiEntry(entry)
    if (desired !== null) return { desiredPackage: desired }
  }
  return null
}

export function detectV2ServerEntry(configDir: string): V2ServerEntry | null {
  const config = readServerConfig(configDir)
  if (config === null) return null
  return entryFromV2Plugins(config["plugins"]) ?? entryFromLegacyPlugin(config["plugin"])
}

function cliEntryPackage(entry: unknown): string | null {
  if (typeof entry === "string") return entry
  if (isPlainRecord(entry) && typeof entry["package"] === "string") return entry["package"]
  return null
}

function isOmoCliPluginEntry(entry: unknown): boolean {
  if (typeof entry === "string") return isAnyOmoTuiPluginEntry(entry)
  const pkg = cliEntryPackage(entry)
  if (pkg === null) return false
  return isServerPluginEntry(pkg) || isNamedTuiPluginEntry(pkg)
}

function cliEntryPresents(entries: readonly unknown[], desiredPackage: string): boolean {
  return entries.some((entry) => cliEntryPackage(entry) === desiredPackage)
}

function sameEntries(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length
    && left.every((entry, index) => JSON.stringify(entry) === JSON.stringify(right[index]))
}

function desiredCliEntry(serverEntry: V2ServerEntry): { package: string; options: Record<string, unknown> } {
  return { package: serverEntry.desiredPackage, options: serverEntry.options ?? {} }
}

function readCliConfig(cliJsonPath: string): { config: ConfigShape; malformed: boolean } {
  if (!existsSync(cliJsonPath)) {
    return { config: {}, malformed: false }
  }
  const config = readConfig(cliJsonPath)
  if (config === null) return { config: {}, malformed: true }
  if (config["plugins"] !== undefined && !Array.isArray(config["plugins"])) {
    return { config: {}, malformed: true }
  }
  return { config, malformed: false }
}

export function ensureTuiPluginCliEntry(input: {
  readonly configDir: string
  readonly serverEntry: V2ServerEntry
}): EnsureTuiPluginEntryResult {
  const cliJsonPath = join(input.configDir, "cli.json")
  const { config, malformed } = readCliConfig(cliJsonPath)
  if (malformed) {
    return { changed: false, reason: "malformed" }
  }

  const currentEntries: readonly unknown[] = Array.isArray(config["plugins"]) ? config["plugins"] : []
  if (cliEntryPresents(currentEntries, input.serverEntry.desiredPackage)) {
    return { changed: false, reason: "already-present" }
  }

  const keptEntries = currentEntries.filter((entry) => !isOmoCliPluginEntry(entry))
  const updatedEntries: unknown[] = [...keptEntries, desiredCliEntry(input.serverEntry)]
  if (sameEntries(currentEntries, updatedEntries)) {
    return { changed: false, reason: "already-present" }
  }

  mkdirSync(input.configDir, { recursive: true })
  writeFileAtomically(cliJsonPath, formatConfig({ ...config, plugins: updatedEntries }))
  return { changed: true, reason: "added" }
}
