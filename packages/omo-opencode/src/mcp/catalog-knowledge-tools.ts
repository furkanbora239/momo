import type { McpToolDescriptor } from "@oh-my-opencode/mcp-stdio-core"
import {
  listModelsMissingKnowledge,
  readCatalogKnowledge,
  readModelKnowledge,
  upsertCatalogKnowledge,
  type ModelKnowledge,
} from "../shared/catalog-knowledge"

export interface CatalogKnowledgeToolsResult {
  readonly tools: readonly McpToolDescriptor[]
  readonly handlers: CatalogKnowledgeToolHandlers
}

export type CatalogKnowledgeToolHandlers = {
  catalog_knowledge: (args: CatalogKnowledgeReadArgs) => CatalogKnowledgeReadResult
  catalog_enrich: (args: CatalogKnowledgeEnrichArgs) => CatalogKnowledgeEnrichResult
}

export type CatalogKnowledgeReadArgs = {
  model_keys?: string[]
  provider?: string
  model?: string
}

export type CatalogKnowledgeReadResult = {
  missing: string[]
  entry?: ModelKnowledge
  total_known: number
  updatedAt: string
}

export type CatalogKnowledgeEnrichArgs = {
  entries: ModelKnowledge[]
}

export type CatalogKnowledgeEnrichResult = {
  upserted: number
  total: number
  updatedAt: string
}

/**
 * Build the catalog_knowledge and catalog_enrich tool descriptors plus their
 * handler functions. The integration step registers the descriptors with the
 * MCP server and wires the handlers into the tools/call dispatch.
 *
 * Does NOT register the tools itself; the caller owns registration.
 */
export function createCatalogKnowledgeTools(): CatalogKnowledgeToolsResult {
  const tools: McpToolDescriptor[] = [
    {
      name: "catalog_knowledge",
      description:
        "Read the runtime catalog knowledge cache. Returns the list of model keys (from the connected provider catalog) that are MISSING knowledge entries, plus optionally the stored knowledge for a specific provider/model. Use this to identify which models need enrichment before invoking catalog_enrich.",
      inputSchema: {
        type: "object",
        properties: {
          model_keys: {
            type: "array",
            items: { type: "string" },
            description:
              "Model keys to check for missing knowledge (format: 'providerID/modelID' or 'modelID'). Returns only those with no cached entry.",
          },
          provider: {
            type: "string",
            description: "Provider ID to look up stored knowledge for a specific model.",
          },
          model: {
            type: "string",
            description: "Model ID to look up stored knowledge for (requires provider).",
          },
        },
        additionalProperties: false,
      },
    },
    {
      name: "catalog_enrich",
      description:
        "Persist verified model knowledge into the runtime catalog knowledge cache. Accepts an array of ModelKnowledge objects (each with mandatory sources and fetchedAt). Merges by key (provider/model or model id). Use after the catalog-researcher agent has gathered sourced facts.",
      inputSchema: {
        type: "object",
        properties: {
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                provider: { type: "string" },
                description: { type: "string" },
                strengths: { type: "array", items: { type: "string" } },
                weaknesses: { type: "array", items: { type: "string" } },
                benchmarks: { type: "object" },
                bestFor: { type: "array", items: { type: "string" } },
                roles: { type: "array", items: { type: "string" } },
                sources: { type: "array", items: { type: "string" } },
                fetchedAt: { type: "string" },
              },
              required: ["id", "sources", "fetchedAt"],
              additionalProperties: false,
            },
            description: "Array of ModelKnowledge objects to upsert into the cache.",
          },
        },
        required: ["entries"],
        additionalProperties: false,
      },
    },
  ]

  const handlers: CatalogKnowledgeToolHandlers = {
    catalog_knowledge: handleCatalogKnowledgeRead,
    catalog_enrich: handleCatalogKnowledgeEnrich,
  }

  return { tools, handlers }
}

function handleCatalogKnowledgeRead(args: CatalogKnowledgeReadArgs): CatalogKnowledgeReadResult {
  const catalog = readCatalogKnowledge()
  const missing = args.model_keys ? listModelsMissingKnowledge(args.model_keys) : []
  let entry: ModelKnowledge | undefined
  if (args.provider && args.model) {
    entry = readModelKnowledge(args.provider, args.model)
  }
  return {
    missing,
    entry,
    total_known: Object.keys(catalog.entries).length,
    updatedAt: catalog.updatedAt,
  }
}

function handleCatalogKnowledgeEnrich(args: CatalogKnowledgeEnrichArgs): CatalogKnowledgeEnrichResult {
  const validEntries = args.entries.filter(
    (entry) => entry.id && Array.isArray(entry.sources) && entry.sources.length > 0 && typeof entry.fetchedAt === "string",
  )
  const result = upsertCatalogKnowledge(validEntries)
  return {
    upserted: validEntries.length,
    total: Object.keys(result.entries).length,
    updatedAt: result.updatedAt,
  }
}
