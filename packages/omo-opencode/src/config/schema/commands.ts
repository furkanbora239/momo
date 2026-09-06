import { z } from "zod"

export const BuiltinCommandNameSchema = z.enum([
  "goal",
  "stop-continuation",
  "handoff",
  "advisor",
  "momo",
  "caveman",
  "cavemen",
  "c",
  // Removed builtin command names kept for backward compat; treated as no-ops.
  "help",
  "start-work",
  "refactor",
  "remove-ai-slops",
  "hyperplan",
])

export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>
