import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { NativeKnowledgeFact, NativeModelRef } from "../native-routing/types"

export interface NativeCatalogKnowledgeEntry extends NativeModelRef {
  readonly summary?: string
  readonly strengths?: readonly string[]
  readonly limitations?: readonly string[]
  readonly sources: readonly string[]
  readonly researchedAt: string
}

export interface NativeCatalogKnowledgeStore {
  read(model: NativeModelRef): NativeKnowledgeFact | undefined
  upsert(entry: NativeCatalogKnowledgeEntry): void
}

type StoreData = { version: 1; entries: Record<string, NativeCatalogKnowledgeEntry> }

function key(model: NativeModelRef): string {
  return `${model.providerID}/${model.id}`
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isEntry(value: unknown): value is NativeCatalogKnowledgeEntry {
  if (!isObject(value) || typeof value.providerID !== "string" || typeof value.id !== "string" ||
    typeof value.researchedAt !== "string" || !Number.isFinite(Date.parse(value.researchedAt)) ||
    !Array.isArray(value.sources) || !value.sources.every((source) => typeof source === "string" && source.trim().length > 0)) return false
  return (value.summary === undefined || typeof value.summary === "string") &&
    (value.strengths === undefined || (Array.isArray(value.strengths) && value.strengths.every((item) => typeof item === "string"))) &&
    (value.limitations === undefined || (Array.isArray(value.limitations) && value.limitations.every((item) => typeof item === "string")))
}

export function createNativeCatalogKnowledgeStore(filePath: string): NativeCatalogKnowledgeStore {
  function readStore(): StoreData {
    if (!existsSync(filePath)) return { version: 1, entries: {} }
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"))
    if (!isObject(parsed) || parsed.version !== 1 || !isObject(parsed.entries)) {
      throw new Error("native catalog knowledge file has an unsupported schema")
    }
    const entries: Record<string, NativeCatalogKnowledgeEntry> = {}
    for (const [entryKey, entry] of Object.entries(parsed.entries)) {
      if (!isEntry(entry)) throw new Error(`native catalog knowledge record is malformed: ${entryKey}`)
      entries[entryKey] = entry
    }
    return { version: 1, entries }
  }

  return {
    read(model) {
      const entry = readStore().entries[key(model)]
      if (!entry) return undefined
      const sources = entry.sources.map((source) => source.trim()).filter(Boolean)
      const known = sources.length > 0
      const fact: NativeKnowledgeFact = {
        model,
        known,
        ...(entry.summary ? { summary: entry.summary } : {}),
        ...(entry.strengths ? { strengths: entry.strengths } : {}),
        ...(entry.limitations ? { limitations: entry.limitations } : {}),
        ...(known ? { source: sources.join(", ") } : {}),
        verifiedAt: entry.researchedAt,
      }
      return fact
    },
    upsert(entry) {
      if (!isEntry(entry) || entry.sources.length === 0) throw new Error("catalog research must include at least one non-empty source")
      const current = readStore()
      const next: StoreData = { version: 1, entries: { ...current.entries, [key(entry)]: { ...entry, sources: entry.sources.map((source) => source.trim()) } } }
      const directory = dirname(filePath)
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      writeFileSync(filePath, JSON.stringify(next, null, 2), { encoding: "utf8", mode: 0o600 })
    },
  }
}
