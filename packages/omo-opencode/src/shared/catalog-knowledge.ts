import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const CATALOG_KNOWLEDGE_FILENAME = "catalog-knowledge.json"
const OMO_DIR = ".omo"
const CURRENT_VERSION = 1 as const

export type ModelKnowledge = {
  id: string
  provider?: string
  description?: string
  strengths?: string[]
  weaknesses?: string[]
  benchmarks?: Record<string, string | number>
  bestFor?: string[]
  roles?: string[]
  sources: string[]
  fetchedAt: string
}

export type CatalogKnowledge = {
  version: 1
  entries: Record<string, ModelKnowledge>
  updatedAt: string
}

function emptyCatalog(): CatalogKnowledge {
  return { version: CURRENT_VERSION, entries: {}, updatedAt: new Date().toISOString() }
}

export function resolveCatalogKnowledgePath(): string {
  return join(homedir(), OMO_DIR, CATALOG_KNOWLEDGE_FILENAME)
}

export function readCatalogKnowledge(): CatalogKnowledge {
  const filePath = resolveCatalogKnowledgePath()
  if (!existsSync(filePath)) return emptyCatalog()
  try {
    const raw = readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(raw) as unknown
    if (!isRecord(parsed)) return emptyCatalog()
    const version = parsed["version"]
    const entries = parsed["entries"]
    const updatedAt = parsed["updatedAt"]
    if (version !== CURRENT_VERSION || !isRecord(entries) || typeof updatedAt !== "string") {
      return emptyCatalog()
    }
    const sanitized: Record<string, ModelKnowledge> = {}
    for (const [key, value] of Object.entries(entries)) {
      if (isRecord(value) && isValidModelKnowledge(value)) {
        sanitized[key] = value as ModelKnowledge
      }
    }
    return { version: CURRENT_VERSION, entries: sanitized, updatedAt }
  } catch {
    return emptyCatalog()
  }
}

export function upsertCatalogKnowledge(entries: ModelKnowledge[]): CatalogKnowledge {
  const current = readCatalogKnowledge()
  const merged = { ...current.entries }
  for (const entry of entries) {
    if (!entry.id || !Array.isArray(entry.sources) || typeof entry.fetchedAt !== "string") continue
    const key = entry.provider ? `${entry.provider}/${entry.id}` : entry.id
    merged[key] = entry
  }
  const next: CatalogKnowledge = {
    version: CURRENT_VERSION,
    entries: merged,
    updatedAt: new Date().toISOString(),
  }
  persistCatalogKnowledge(next)
  return next
}

export function readModelKnowledge(providerID: string, modelID: string): ModelKnowledge | undefined {
  const catalog = readCatalogKnowledge()
  return catalog.entries[`${providerID}/${modelID}`] ?? catalog.entries[modelID]
}

export function mergeKnowledgeProfile<T extends object>(
  base: T | undefined,
  knowledge: ModelKnowledge | undefined,
): T | undefined {
  if (!base) return base
  if (!knowledge) return base
  const result = { ...base } as Record<string, unknown>
  if (result["description"] === undefined && knowledge.description !== undefined) {
    result["description"] = knowledge.description
  }
  if (isEmptyStringArray(result["strengths"]) && knowledge.strengths && knowledge.strengths.length > 0) {
    result["strengths"] = knowledge.strengths
  }
  if (isEmptyStringArray(result["weaknesses"]) && knowledge.weaknesses && knowledge.weaknesses.length > 0) {
    result["weaknesses"] = knowledge.weaknesses
  }
  if (isEmptyStringArray(result["bestFor"]) && knowledge.bestFor && knowledge.bestFor.length > 0) {
    result["bestFor"] = knowledge.bestFor
  }
  if (isEmptyStringArray(result["bestUseCases"]) && knowledge.bestFor && knowledge.bestFor.length > 0) {
    result["bestUseCases"] = knowledge.bestFor
  }
  if (isEmptyStringArray(result["roles"]) && knowledge.roles && knowledge.roles.length > 0) {
    result["roles"] = knowledge.roles
  }
  if (result["benchmarks"] === undefined && knowledge.benchmarks !== undefined) {
    result["benchmarks"] = knowledge.benchmarks
  }
  return result as T
}

export function listModelsMissingKnowledge(modelKeys: string[]): string[] {
  const catalog = readCatalogKnowledge()
  return modelKeys.filter((key) => !(key in catalog.entries))
}

function persistCatalogKnowledge(catalog: CatalogKnowledge): void {
  const filePath = resolveCatalogKnowledgePath()
  const dir = join(homedir(), OMO_DIR)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(filePath, JSON.stringify(catalog, null, 2), "utf-8")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isValidModelKnowledge(value: Record<string, unknown>): boolean {
  return (
    typeof value["id"] === "string" &&
    Array.isArray(value["sources"]) &&
    typeof value["fetchedAt"] === "string"
  )
}

function isEmptyStringArray(value: unknown): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0)
}
