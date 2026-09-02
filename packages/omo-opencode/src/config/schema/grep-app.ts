import { z } from "zod"

// Configuration for the built-in `grep_app` MCP (remote). Remote MCPs are
// opt-in (momo Wave 1): their tool schemas are only injected into requests
// when explicitly enabled here.
export const GrepAppConfigSchema = z.object({
  enabled: z.boolean().default(false).describe("Enable the built-in grep_app MCP (default: false)."),
})

export type GrepAppConfig = z.infer<typeof GrepAppConfigSchema>
export type GrepAppConfigInput = z.input<typeof GrepAppConfigSchema>
