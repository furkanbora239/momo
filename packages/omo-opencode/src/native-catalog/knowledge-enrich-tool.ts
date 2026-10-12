import type { Plugin } from "@opencode/plugin"
import type { Info, ToolContext } from "@opencode/plugin/promise/tool"
import type { NativeCatalogKnowledgeEntry, NativeCatalogKnowledgeStore } from "./knowledge-store"

const inputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    providerID: { type: "string", minLength: 1 },
    id: { type: "string", minLength: 1 },
    summary: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    limitations: { type: "array", items: { type: "string" } },
    sources: { type: "array", minItems: 1, items: { type: "string", minLength: 1 } },
  },
  required: ["providerID", "id", "sources"],
} as const

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string" && item.trim().length > 0)) return undefined
  return value.map((item) => (item as string).trim())
}

function sourceList(value: unknown): string[] | undefined {
  const sources = stringList(value)
  if (!sources || sources.length === 0) return undefined
  for (const source of sources) {
    try {
      const url = new URL(source)
      if (url.protocol !== "https:" && url.protocol !== "http:") return undefined
    } catch {
      return undefined
    }
  }
  return sources
}

function parseEntry(value: unknown, researchedAt: string): NativeCatalogKnowledgeEntry {
  const record = asRecord(value)
  if (!record || typeof record.providerID !== "string" || !record.providerID.trim() || typeof record.id !== "string" || !record.id.trim()) {
    throw new Error("providerID and model id are required")
  }
  const sources = sourceList(record.sources)
  if (!sources || sources.length === 0) throw new Error("at least one source is required")
  const strengths = record.strengths === undefined ? undefined : stringList(record.strengths)
  const limitations = record.limitations === undefined ? undefined : stringList(record.limitations)
  if (record.strengths !== undefined && !strengths) throw new Error("strengths must be non-empty strings")
  if (record.limitations !== undefined && !limitations) throw new Error("limitations must be non-empty strings")
  if (record.summary !== undefined && typeof record.summary !== "string") throw new Error("summary must be a string")
  return {
    providerID: record.providerID.trim(),
    id: record.id.trim(),
    ...(typeof record.summary === "string" && record.summary ? { summary: record.summary } : {}),
    ...(strengths ? { strengths } : {}),
    ...(limitations ? { limitations } : {}),
    sources,
    researchedAt,
  }
}

export function createNativeCatalogKnowledgeTool(
  store: NativeCatalogKnowledgeStore,
  isOwnedResearcher: (agentID: string) => boolean,
  now: () => number = Date.now,
): Info {
  return {
    name: "momo_catalog_enrich",
    options: { permission: "momo_catalog_enrich", codemode: false },
    description: "Save a source-backed model research profile. Use only published model/provider documentation; this does not record task success.",
    input: inputSchema,
    execute: async (input, context: ToolContext) => {
      if (context.agent !== "momo-catalog-researcher" || !isOwnedResearcher(context.agent)) {
        throw new Error("momo_catalog_enrich is restricted to the active momo catalog-researcher")
      }
      const entry = parseEntry(input, new Date(now()).toISOString())
      store.upsert(entry)
      return { content: `Saved sourced profile for ${entry.providerID}/${entry.id}.` }
    },
  }
}

export async function registerNativeCatalogKnowledgeTool(
  context: Pick<Plugin.Context, "tool">,
  store: NativeCatalogKnowledgeStore,
  isOwnedResearcher: (agentID: string) => boolean,
): Promise<() => Promise<void>> {
  const definition = createNativeCatalogKnowledgeTool(store, isOwnedResearcher)
  const registration = await context.tool.transform((editor) => editor.add(definition))
  return () => registration.dispose()
}
