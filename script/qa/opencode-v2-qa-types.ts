/**
 * Shared constants and types for the opencode-v2 migration QA infra (runbook M7).
 *
 * M7 closes the "empty-child P3" gap: inside an isolated XDG sandbox the
 * `opencode-go` provider is inactive, so children dispatched with
 * `opencode-go/deepseek-v4-flash` fail at provider resolution. The seed script
 * makes the sandbox resolve that model deterministically, and the driver wraps
 * the M1d pattern end to end against V2 `/api/*` routes only.
 */

/** V2 API routes. Never use v1 `GET /global/health` (SPA catch-all). */
export const QA_API = {
  /** GET -> JSON array. Used as the health check (v2 route, not HTML). */
  health: "/api/session",
  /** GET -> session list. */
  sessionList: "/api/session",
  /** POST {} -> { data: { id } }. */
  sessionCreate: "/api/session",
  /** POST { text } -> prompt a session. */
  sessionPrompt: (id: string): string => `/api/session/${id}/prompt`,
  /** GET -> per-session messages. */
  sessionMessages: (id: string): string => `/api/session/${id}/message`,
  /** GET -> connected provider list (proves momo plugin + seed active). */
  provider: "/api/provider",
} as const;

/** Verdict-noise markers that must stay at 0 for a healthy harness. */
export const VERDICT_NOISE_MARKERS = [
  "gone from status",
  "Step interrupted",
  "degrading to no-op",
] as const;

/** Runbook model the seed makes resolvable in the sandbox. */
export const RUNBOOK_MODEL = "opencode-go/deepseek-v4-flash";

/** How many parallel background children the parent must dispatch. */
export const REQUIRED_PARALLEL_CHILDREN = 5;

/** Wait budgets. Full run mirrors M1d (~115s); self-test is a quick smoke. */
export const WAIT_FULL_MS = 120_000;
export const WAIT_SELFTEST_MS = 40_000;
/** Poll budget for the provider list to reconcile `opencode-go` (async). */
export const PROVIDER_POLL_MS = 30_000;

/**
 * Parent prompt that dispatches the parallel children. Each child is a worker-class
 * (sisyphus-junior) agent via category quick. The child prompt forces the read-side
 * baseline tools (codegraph_explore, skill, websearch, webfetch) to be exercised so
 * the regression exam can positively assert their presence on the observed surface
 * (M2b). The model otherwise tends to use native read-side tools and skip the
 * codegraph MCP, so each call is made a hard, ordered requirement.
 */
export const PARENT_PROMPT =
  "Spawn exactly 5 parallel background tasks, category quick, " +
  `model ${RUNBOOK_MODEL}, each with prompt: ` +
  "'You MUST call each of these four tools and include its raw output in your reply, " +
  "or your answer is invalid: " +
  "(1) codegraph_explore with path set to the repository root; " +
  "(2) the skill tool to load any available skill (list skills first if needed); " +
  "(3) websearch for the phrase opencode v2 tool permissions; " +
  "(4) webfetch with url https://opencode.ai. " +
  "After all four, append a 3-line summary of README.md. Do NOT use read/grep/glob " +
  "for these four steps — only the named tools.' " +
  "Run them all in parallel. Return immediately after dispatching.";

export type QaMode = "self-test" | "full" | "regression";

export interface QaOptions {
  mode: QaMode;
  /** Opencode binary. Defaults to `opencode` on PATH. */
  opencodeBin?: string;
  /** Base dir for the isolated XDG sandbox (a unique subdir is created). */
  sandboxBase?: string;
  /** Where to write evidence. Defaults to .omo/evidence/<date>-m7-qa-infra. */
  evidenceDir?: string;
  /** Server port (a free one is chosen when omitted). */
  port?: number;
  /** Skip cleanup of the sandbox temp dir (keep for inspection). */
  keepSandbox?: boolean;
}

/** Result of one QA run, consumed by the regression exam. */
export interface QaResult {
  mode: QaMode;
  passed: boolean;
  /** Human-readable failing asserts (empty when passed). */
  failures: string[];
  childCount: number;
  childrenWithToolSurface: number;
  /** Union of tool names observed across child sessions. */
  toolUnion: string[];
  verdictNoise: Record<string, number>;
  evidenceDir: string;
  sandboxDir: string;
  port: number;
}
