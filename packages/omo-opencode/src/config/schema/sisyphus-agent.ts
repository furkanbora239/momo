import { z } from "zod"

export const SisyphusAgentConfigSchema = z.object({
  disabled: z.boolean().optional(),
  default_builder_enabled: z.boolean().optional(),
  planner_enabled: z.boolean().optional(),
  replace_plan: z.boolean().optional(),
  tdd: z.boolean().default(true).optional(),
  thinking_budget_tokens: z.number().int().positive().max(32000).optional(),
})

export type SisyphusAgentConfig = z.infer<typeof SisyphusAgentConfigSchema>
