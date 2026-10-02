import { hasMigrationMarker } from "@oh-my-opencode/omo-config-core"
import { parseJsonc } from "@oh-my-opencode/utils"
import { existsSync, readFileSync } from "node:fs"

import { writeFileAtomically } from "../shared/write-file-atomically"
import { isPlainRecord, copyRecord } from "./record-values"
import type { ConfigMigrationTransformResult } from "./transform-types"

/**
 * OpenCode V2 renamed the plugin registration key from `plugin` to `plugins`
 * and switched tuple entries to `{ package, options }` objects. This module
 * normalizes the opencode config files momo writes or reads. It cannot go
 * through the omo-config-core migration engine because that engine only
 * accepts omo.json[c] targets (writerInput + OmoConfigSchema validation), so
 * the write uses the repo-standard atomic write plus the shared
 * `_migrations` marker discipline instead.
 */

export const OPENCODE_V2_PLUGIN_MIGRATION_ID = "2026-09-opencode-v2-plugins"

export type OpenCodeV2PluginEntry = string | { readonly package: string; readonly options?: Record<string, unknown> }

export type OpenCodeV2PluginMigrationReason =
  | "migrated"
  | "unchanged"
  | "malformed"
  | "already-migrated"

export type OpenCodeV2PluginMigrationResult = {
  readonly changed: boolean
  readonly reason: OpenCodeV2PluginMigrationReason
  readonly diagnostics: readonly string[]
}

function displayValue(value: unknown): string {
  return JSON.stringify(value) ?? String(value)
}

function migratePluginEntry(entry: unknown, index: number, diagnostics: string[]): unknown {
  if (typeof entry === "string") return entry
  if (Array.isArray(entry) && typeof entry[0] === "string") {
    const migrated: { package: string; options?: Record<string, unknown> } = { package: entry[0] }
    const options = entry[1]
    if (options !== undefined) {
      if (isPlainRecord(options)) migrated.options = copyRecord(options)
      else {
        diagnostics.push(
          `conflict: plugin[${index}] dropped non-object options ${displayValue(options)} kept package=${displayValue(entry[0])}`,
        )
      }
    }
    return migrated
  }
  diagnostics.push(`conflict: plugin[${index}] left unrecognized entry ${displayValue(entry)}`)
  return entry
}

function pluginEntryId(entry: unknown): string | null {
  if (typeof entry === "string") return entry
  if (isPlainRecord(entry) && typeof entry["package"] === "string") return entry["package"]
  return null
}

function mergedPluginEntries(
  existing: unknown,
  migrated: readonly unknown[],
  diagnostics: string[],
): unknown[] {
  const existingEntries = Array.isArray(existing) ? existing : []
  const result: unknown[] = [...existingEntries]
  const existingById = new Map<string, unknown>()
  for (const entry of existingEntries) {
    const id = pluginEntryId(entry)
    if (id !== null && !existingById.has(id)) existingById.set(id, entry)
  }
  for (const [index, entry] of migrated.entries()) {
    const id = pluginEntryId(entry)
    const kept = id === null ? undefined : existingById.get(id)
    if (kept === undefined) {
      result.push(entry)
      continue
    }
    diagnostics.push(`skipped: plugin[${index}] legacy=${displayValue(entry)} kept=${displayValue(kept)}`)
  }
  return result
}

export function transformOpenCodeV2Plugins(document: unknown): ConfigMigrationTransformResult {
  const diagnostics: string[] = []
  if (!isPlainRecord(document)) return { diagnostics, document: {} }
  if (document["plugin"] === undefined) return { diagnostics, document: copyRecord(document) }

  const result = copyRecord(document)
  const legacyEntries = document["plugin"]
  if (!Array.isArray(legacyEntries)) {
    diagnostics.push(`conflict: plugin expected an array, left unchanged (${displayValue(legacyEntries)})`)
    return { diagnostics, document: result }
  }
  if (result["plugins"] !== undefined && !Array.isArray(result["plugins"])) {
    diagnostics.push(`conflict: plugins expected an array, plugin kept unchanged (${displayValue(result["plugins"])})`)
    return { diagnostics, document: result }
  }

  const migrated = legacyEntries.map((entry, index) => migratePluginEntry(entry, index, diagnostics))
  result["plugins"] = mergedPluginEntries(result["plugins"], migrated, diagnostics)
  delete result["plugin"]
  return { diagnostics, document: result }
}

function stampedMarker(document: Record<string, unknown>): readonly string[] {
  const existing = document["_migrations"]
  const markers = Array.isArray(existing) ? existing.filter((marker): marker is string => typeof marker === "string") : []
  return markers.includes(OPENCODE_V2_PLUGIN_MIGRATION_ID) ? markers : [...markers, OPENCODE_V2_PLUGIN_MIGRATION_ID]
}

function formatDocument(document: Record<string, unknown>): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

export function applyOpenCodeV2PluginMigration(path: string): OpenCodeV2PluginMigrationResult {
  if (!existsSync(path)) return { changed: false, reason: "unchanged", diagnostics: [] }
  let value: unknown
  try {
    value = parseJsonc<unknown>(readFileSync(path, "utf-8"))
  } catch (error) {
    return {
      changed: false,
      reason: "malformed",
      diagnostics: [`malformed: ${path} (${error instanceof Error ? error.message : String(error)})`],
    }
  }
  if (!isPlainRecord(value)) {
    return { changed: false, reason: "malformed", diagnostics: [`malformed: ${path} is not a JSONC object`] }
  }
  if (hasMigrationMarker(value, OPENCODE_V2_PLUGIN_MIGRATION_ID)) {
    return { changed: false, reason: "already-migrated", diagnostics: [] }
  }
  if (value["plugin"] === undefined) {
    return { changed: false, reason: "unchanged", diagnostics: [] }
  }

  const transformed = transformOpenCodeV2Plugins(value)
  if (transformed.document["plugin"] !== undefined) {
    return { changed: false, reason: "unchanged", diagnostics: [...transformed.diagnostics] }
  }
  const document: Record<string, unknown> = { ...transformed.document, _migrations: stampedMarker(transformed.document) }
  writeFileAtomically(path, formatDocument(document))
  return { changed: true, reason: "migrated", diagnostics: [...transformed.diagnostics] }
}
