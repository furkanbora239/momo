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
import { writeFileAtomically } from "../../shared/write-file-atomically"

type ConfigShape = {
  plugin?: string[]
  [key: string]: unknown
}

export type EnsureTuiPluginEntryResult = {
  readonly changed: boolean
  readonly reason: string
}

function readConfig(path: string): ConfigShape | null {
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

function readServerConfig(configDir: string): ConfigShape | null {
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

function desiredTuiEntry(serverEntry: string): string | null {
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

function isAnyOmoTuiPluginEntry(entry: unknown): boolean {
  return isNamedTuiPluginEntry(entry) || isServerPluginEntry(entry)
}

function readTuiConfig(tuiJsonPath: string): { config: ConfigShape; malformed: boolean } {
  if (!existsSync(tuiJsonPath)) {
    return { config: {}, malformed: false }
  }
  const config = readConfig(tuiJsonPath)
  return config ? { config, malformed: false } : { config: {}, malformed: true }
}

function formatConfig(config: ConfigShape): string {
  return `${JSON.stringify(config, null, 2)}\n`
}

export function ensureTuiPluginEntry(opts: { configDir?: string } = {}): EnsureTuiPluginEntryResult {
  const configDir = opts.configDir ?? getOpenCodeConfigDir({ binary: "opencode", version: null })
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
