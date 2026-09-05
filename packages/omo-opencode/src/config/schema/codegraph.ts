import { z } from "zod"

export const CodegraphConfigSchema = z.object({
  auto_init: z.boolean().default(true),
  auto_provision: z.boolean().default(true),
  auto_warmup: z.boolean().optional(),
  daemon: z.boolean().default(true),
  enabled: z.boolean().default(true),
  excluded_roots: z.array(z.string()).optional(),
  idle_timeout_ms: z.number().finite().nonnegative().optional(),
  install_dir: z.string().optional(),
  telemetry: z.boolean().optional(),
  watch_debounce_ms: z.number().nonnegative().optional(),
})

export type CodegraphConfig = z.infer<typeof CodegraphConfigSchema>
