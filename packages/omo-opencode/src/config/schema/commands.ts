import { z } from "zod"

export const BuiltinCommandNameSchema = z.enum([
 "goal",
 "refactor",
 "start-work",
 "stop-continuation",
 "handoff",
 "remove-ai-slops",
 "hyperplan",
 "advisor",
 "help",
])

export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>
