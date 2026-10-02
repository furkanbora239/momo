import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

import {
  isOurFilePluginEntry,
  isNamedTuiPluginEntry,
  isServerPluginEntry,
} from "../doctor/checks/tui-plugin-config"
import {
  LEGACY_PLUGIN_NAME,
  PLUGIN_NAME,
  getOpenCodeConfigDir,
  parseJsonc,
} from "../../shared"
import { defaultOpenCodeVersionProbe, isOpenCodeV2, type OpenCodeVersionProbe } from "../../shared/opencode-version-probe"
import { writeFileAtomically } from "../../shared/write-file-atomically"
import { applyOpenCodeV2PluginMigration } from "../../config-migration"
import {
  detectV2ServerEntry,
  ensureTuiPluginCliEntry,
  existingServerConfigPath,
} from "./add-tui-plugin-to-cli-config"

export type ConfigShape = {
  plugin?: string[]
  [key: string]: unknown
}

export type EnsureTuiPluginEntryResult = {
  readonly changed: boolean
  readonly reason: string
  readonly diagnostics?: readonly string[]
}

export function readConfig(path: string): ConfigShape | null {
  try {
    const parsed = parseJsonc<unknown>(readFileSync(path, "utf-8"))
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as ConfigShape
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error
  }
  return null
}

export function readServerConfig(configDir: string): ConfigShape | null {
  const jsoncPath = join(configDir, "opencode.jsonc")
  if (existsSync(jsoncPath)) return readConfig(jsoncPath)

  const jsonPath = join(configDir, "opencode.json")
  if (existsSync(jsonPath)) return readConfig(jsonPath)

  return null
}

function pluginEntries(config: ConfigShape): string[] {
  return Array.isArray(config.plugin)
    ? config.plugin.filter((entry): entry is string => typeof entry === "string")
    : []
}

function fileEntryPackageDir(entry: string): string | null {
  let path = entry.slice("file:".length)
  if (path.startsWith("//")) path = path.slice(2)
  if (path.endsWith(".js") || path.endsWith(".mjs") || path.endsWith(".ts")) {
    const parent = dirname(path)
    if (existsSync(join(parent, "package.json"))) return parent
    if (existsSync(join(dirname(parent), "package.json"))) return dirname(parent)
    return parent
  }
  return null
}

export function desiredTuiEntry(serverEntry: string): string | null {
  if (serverEntry === PLUGIN_NAME || serverEntry.startsWith(`${PLUGIN_NAME}@`)) {
    return serverEntry
  }
  if (serverEntry === LEGACY_PLUGIN_NAME || serverEntry.startsWith(`${LEGACY_PLUGIN_NAME}@`)) {
    return serverEntry
  }
  if (serverEntry.startsWith("file:") && isOurFilePluginEntry(serverEntry)) {
    const pkgDir = fileEntryPackageDir(serverEntry)
    if (pkgDir) {
      return serverEntry.startsWith("file://") ? pathToFileURL(pkgDir).href : `file:${pkgDir}`
    }
    return serverEntry
  }
  return null
}

export function isAnyOmoTuiPluginEntry(entry: unknown): boolean {
  return isNamedTuiPluginEntry(entry) || isServerPluginEntry(entry)
}

function readTuiConfig(tuiJsonPath: string): { config: ConfigShape; malformed: boolean } {
  if (!existsSync(tuiJsonPath)) {
    return { config: {}, malformed: false }
  }
  const config = readConfig(tuiJsonPath)
  return config ? { config, malformed: false } : { config: {}, malformed: true }
}

export function formatConfig(config: ConfigShape): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

function ensureTuiPluginEntryV1(configDir: string): EnsureTuiPluginEntryResult {
  const serverConfig = readServerConfig(configDir)
  const serverEntry = serverConfig ? pluginEntries(serverConfig).find(isServerPluginEntry) : undefined
  if (!serverEntry) {
    return { changed: false, reason: "no-server-entry" }
  }

  const desiredEntry = desiredTuiEntry(serverEntry)
  if (!desiredEntry) {
    return { changed: false, reason: "no-server-entry" }
  }

  const tuiJsonPath = join(configDir, "tui.json")
  const { config, malformed } = readTuiConfig(tuiJsonPath)
  if (malformed) {
    return { changed: false, reason: "malformed" }
  }

  const currentPlugins = pluginEntries(config)
  const isAlreadySoleEntry = currentPlugins.length === 1 && currentPlugins[0] === desiredEntry
  if (isAlreadySoleEntry) {
    return { changed: false, reason: "already-present" }
  }

  const nonOmoPlugins = currentPlugins.filter((entry) => !isAnyOmoTuiPluginEntry(entry))
  const updatedPlugins = [...nonOmoPlugins, desiredEntry]

  if (
    currentPlugins.length === updatedPlugins.length &&
    currentPlugins.every((entry, i) => entry === updatedPlugins[i])
  ) {
    return { changed: false, reason: "already-present" }
  }

  mkdirSync(configDir, { recursive: true })
  writeFileAtomically(tuiJsonPath, formatConfig({ ...config, plugin: updatedPlugins }))
  return { changed: true, reason: "added" }
}

function ensureTuiPluginEntryV2(configDir: string): EnsureTuiPluginEntryResult {
  const serverConfigPath = existingServerConfigPath(configDir)
  const migration = serverConfigPath === null ? undefined : applyOpenCodeV2PluginMigration(serverConfigPath)
  const migrationDiagnostics = migration?.diagnostics.length ? migration.diagnostics : undefined

  const serverEntry = detectV2ServerEntry(configDir)
  if (serverEntry === null) {
    return {
      changed: migration?.changed ?? false,
      reason: migration?.changed ? "migrated" : "no-server-entry",
      ...(migrationDiagnostics === undefined ? {} : { diagnostics: migrationDiagnostics }),
    }
  }

  const cliResult = ensureTuiPluginCliEntry({ configDir, serverEntry })
  if (cliResult.changed) {
    return {
      changed: true,
      reason: "added",
      ...(migrationDiagnostics === undefined ? {} : { diagnostics: migrationDiagnostics }),
    }
  }
  if (migration?.changed) {
    return {
      changed: true,
      reason: "migrated",
      ...(migrationDiagnostics === undefined ? {} : { diagnostics: migrationDiagnostics }),
    }
  }
  return {
    changed: false,
    reason: cliResult.reason,
    ...(migrationDiagnostics === undefined ? {} : { diagnostics: migrationDiagnostics }),
  }
}

export function ensureTuiPluginEntry(opts: { configDir?: string; versionProbe?: OpenCodeVersionProbe } = {}): EnsureTuiPluginEntryResult {
  const configDir = opts.configDir ?? getOpenCodeConfigDir({ binary: "opencode", version: null })
  const versionProbe = opts.versionProbe ?? defaultOpenCodeVersionProbe
  if (isOpenCodeV2(versionProbe().major)) {
    return ensureTuiPluginEntryV2(configDir)
  }
  return ensureTuiPluginEntryV1(configDir)
}
