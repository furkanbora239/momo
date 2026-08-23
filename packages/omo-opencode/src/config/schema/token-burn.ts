import { z } from "zod"
import type { HookName } from "./hooks"

// Token-burn pruning gates (momo Wave 5). These chat-injection hooks are
// default-OFF to keep orchestrator output lean; each is individually
// re-enableable via its flag. `rules_injector_verbose` trims rulesInjector
// verbosity by default (set true to restore full output).
export const TokenBurnConfigSchema = z.object({
  agent_usage_reminder: z.boolean().default(false),
  category_skill_reminder: z.boolean().default(false),
  todo_description_override: z.boolean().default(false),
  rules_injector_verbose: z.boolean().default(false),
})

export type TokenBurnConfig = z.infer<typeof TokenBurnConfigSchema>

export const DEFAULT_TOKEN_BURN: TokenBurnConfig = {
  agent_usage_reminder: false,
  category_skill_reminder: false,
  todo_description_override: false,
  rules_injector_verbose: false,
}

/** Hooks that are default-OFF unless their opt-in flag is enabled. */
export const DEFAULT_OFF_HOOKS: Readonly<Partial<Record<HookName, keyof TokenBurnConfig>>> = {
  "agent-usage-reminder": "agent_usage_reminder",
  "category-skill-reminder": "category_skill_reminder",
  "todo-description-override": "todo_description_override",
}
