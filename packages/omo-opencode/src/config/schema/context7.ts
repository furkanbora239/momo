import { z } from "zod"

// Configuration for the built-in `context7` MCP (remote). Remote MCPs are
// opt-in (momo Wave 1): their tool schemas are only injected into requests
// when explicitly enabled here.
export const Context7ConfigSchema = z.object({
  enabled: z.boolean().default(false).describe("Enable the built-in context7 MCP (default: false)."),
})

export type Context7Config = z.infer<typeof Context7ConfigSchema>
export type Context7ConfigInput = z.input<typeof Context7ConfigSchema>
