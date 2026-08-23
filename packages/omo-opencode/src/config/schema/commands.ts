import { z } from "zod"

export const BuiltinCommandNameSchema = z.enum([
 "goal",
 "refactor",
 "start-work",
 "stop-continuation",
 "remove-ai-slops",
 "hyperplan",
 "advisor",
])

export type BuiltinCommandName = z.infer<typeof BuiltinCommandNameSchema>
