import { z } from "zod"

export const TuiSidebarConfigSchema = z.object({
  enabled: z.boolean().default(true),
  roster: z.boolean().default(false),
})

export const TuiConfigSchema = z.object({
  sidebar: TuiSidebarConfigSchema.default({ enabled: true, roster: false }),
})

export type TuiConfig = z.infer<typeof TuiConfigSchema>
