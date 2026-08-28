import { z } from "zod"

// Aider-style repo-map auto-injection (momo). Compressed, ranked file tree +
// key symbol signatures read once per session from the local .codegraph SQLite
// index and injected into the first real user message. Default OFF: zero
// surprise cost until `repo_map.enabled` is set.
export const RepoMapConfigSchema = z.object({
  /** Inject a compressed repo map into the first user message of each session (default: false). */
  enabled: z.boolean().default(false),
  /** Approximate token budget for the map body (chars/4 estimate; default: 1536). */
  token_budget: z.number().int().positive().default(1536),
  /** Ranking strategy for which symbols make the map (default: centrality). */
  rank: z.enum(["centrality"]).default("centrality"),
})

export type RepoMapConfig = z.infer<typeof RepoMapConfigSchema>