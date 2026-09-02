import { z } from "zod"

/**
 * Nested delegation config. When `managers` is true (default), the planner and
 * executor manager agents register and can spawn workers via sync `task()`,
 * enabling a 3-level hierarchy: orchestrator → manager → worker.
 *
 * When false, managers stay unregistered and `canSpawnWorkers` degrades to
 * today's plan-family-only behavior.
 *
 * Deviation from plan.md: default is TRUE (user override 2026-09-02).
 */
export const DelegationConfigSchema = z.object({
  managers: z.boolean().default(true),
})

export type DelegationConfig = z.infer<typeof DelegationConfigSchema>
