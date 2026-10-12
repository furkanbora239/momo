import { existsSync } from "node:fs"
import { join } from "node:path"
import { isPlainRecord } from "@oh-my-opencode/utils"

import { isServerPluginEntry } from "../doctor/checks/tui-plugin-config"
import {
  desiredTuiEntry,
  readServerConfig,
} from "./add-tui-plugin-to-tui-config"

export type V2ServerEntry = {
  readonly desiredPackage: string
  readonly options?: Record<string, unknown>
}

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
