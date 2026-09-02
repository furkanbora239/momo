import { z } from "zod"

// Configuration for the built-in `catalog` MCP (Model Catalog, Tier-1).
// The catalog surfaces the connected provider models so the orchestrator can
// pick subagent models at runtime. `prefer` boosts specific model ids for a
// given need string (e.g. { "campaign": "hy3" }); `prefer_providers` boosts
// every row from the listed providers within the same tier/need bucket.
export const CatalogConfigSchema = z
  .object({
    enabled: z.boolean().optional().describe("Enable the built-in catalog MCP (default: true)."),
    providers: z
      .array(z.string())
      .optional()
      .describe("Restrict the catalog to these provider ids. Default: all connected providers."),
    prefer: z
      .record(z.string(), z.union([z.string(), z.array(z.string())]))
      .optional()
      .describe("Boost specific model ids for a need key, e.g. { \"campaign\": \"hy3\" }."),
    prefer_providers: z
      .array(z.string())
      .default([])
      .describe("Boost rows from these provider ids within the same tier/need bucket (default: none — ranking stays capability/cost-neutral)."),
  })
  .optional()

export type CatalogConfig = z.infer<typeof CatalogConfigSchema>
