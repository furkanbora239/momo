import { z } from "zod"

export const BuiltinCommandNameSchema = z.enum([
  "goal",
  "stop-continuation",
  "handoff",
  "advisor",
  "help",
  // Removed builtin command names kept for backward compat; treated as no-ops.
  "start-work",
  "refactor",
  "remove-ai-slops",
  "hyperplan",
])

export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>
