import { z } from "zod"

export const CommentCheckerConfigSchema = z.object({
  /** Master switch. When false, the comment-checker hook becomes a no-op. Defaults to true. */
  enabled: z.boolean().optional(),
  /** Glob patterns for files to skip. Supports `*`, `**`, and exact suffix/segment matches. */
  ignore_paths: z.array(z.string()).optional(),
  /** Custom prompt to replace the default warning message. Use {{comments}} placeholder for detected comments XML. */
  custom_prompt: z.string().optional(),
})

export type CommentCheckerConfig = z.infer<typeof CommentCheckerConfigSchema>
