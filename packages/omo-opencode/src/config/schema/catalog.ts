import { z } from "zod"

// Configuration for the built-in `catalog` MCP (Model Catalog, Tier-1).
// The catalog surfaces the connected provider models so the orchestrator can
// pick subagent models at runtime. `prefer` boosts specific model ids for a
// given need string (e.g. { "campaign": "hy3" }).
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
  })
  .optional()

export type CatalogConfig = z.infer<typeof CatalogConfigSchema>
