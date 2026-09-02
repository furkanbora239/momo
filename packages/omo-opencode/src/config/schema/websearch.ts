import { z } from "zod"

export const WebsearchProviderSchema = z.enum(["exa", "tavily"])

export const WebsearchConfigSchema = z.object({
  /**
   * Opt-in switch for the remote websearch MCP (default: false). The MCP only
   * registers when this is explicitly set to true.
   */
  enabled: z.boolean().default(false).describe("Enable the built-in websearch MCP (default: false)."),
  /**
   * Websearch provider to use.
   * - "exa": Uses Exa websearch (default, works without API key)
   * - "tavily": Uses Tavily websearch (requires TAVILY_API_KEY)
   */
  provider: WebsearchProviderSchema.optional(),
})

export type WebsearchProvider = z.infer<typeof WebsearchProviderSchema>
export type WebsearchConfig = z.infer<typeof WebsearchConfigSchema>
export type WebsearchConfigInput = z.input<typeof WebsearchConfigSchema>
