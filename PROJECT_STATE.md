# PROJECT_STATE.md — momo (My Oh My Openagent)

**Last Updated:** 2026-10-19
**Version / Branch:** `dev`

## Public Jev and source-backed catalog readiness (2026-10-19)

The native zero-config manager now uses official anonymous `opencode/jev-1.13-free`; explicit paid and custom bindings keep their previous authentication. Published models.dev facts, native text/input/output modalities and verified prices feed both cached job classification and final model selection. Public provider admission remains limited to verified free official models, with provider and pool controls preserved. Classifier semantics are versioned so old sparse profiles cannot hide the richer evidence.

Execution topology follows the selected native role. Model preference and task adequacy are separate: uncertain preferences can trigger bounded per-task checks of up to three candidates without lowering the confidence threshold. Free HTTP billing is bound to the official model and endpoint, retains usage, and bypasses paid spend caps without bypassing persistence or replay protection.

Real isolated OpenCode 2.0.32 has already run a free orchestrator, real free Jev and a selected free worker from four candidates to repair TypeScript and pass its actual unit test. Restart reused the classification profiles and published source cache. The full distribution also passed a builtin-registry coding task with Mimo and cold published metadata; builtin three-model classification passed separately. One three-model worker run timed out on Nemotron, so provider reliability is not established. Research/planning/analysis/writing memberships remain unknown. See [the source-bound receipt](notes/qa/native-free-jev-catalog-20261019.json) for exact scope and gates. No real user catalog or credentials were modified by the isolated tests.

## Native v2 live-test repairs and cached job classes (2026-10-19)

The first native live-test repairs are delivered through PRs #38-44: bounded Jev choices, compact task inspection, durable consumption and form delivery, provider admission, single root steering wake, paid/unknown/no-send accounting, model privacy/capacity checks and shared classification/routing budget ownership. F13 file-scope coordination and F14 repeated briefing remain deferred without an established conflicting edit or duplicate injection.

The composed job-class feature now classifies catalog facts in small bounded batches and reuses immutable profiles across restarts and projects. Each task selects class, then native role, then an eligible model. Roles remain separate from job types; provider controls and source fingerprints are rechecked before transport. Unchanged profiles send no additional classification requests. Paid malformed and missing-input usage block capped paid routing and classification across restart. Simultaneous separate processes with an empty shared cache may still each classify before publication.

Generated schema, build, complete monorepo typecheck, fresh full suite and isolated native OpenCode 2.0.32 scenarios passed on the recorded composed source. Exact-head CI and bounded review remain publication gates. See [the repair status](notes/native-v2-live-test-repair-status-20261018.md) and [source-bound receipt](notes/qa/native-job-classification-20261017.json) for counts, native observations, source hashes and coverage limits. Main promotion and npm publishing are separate.

## OpenCode v2 native migration (2026-10-12)

The verified native v2 implementation lives in `packages/omo-opencode/src/native-runtime/`, `native-task/`, `native-routing/`, and `native-catalog/`. The native tool surface is `momo_task` for task lifecycle operations and `momo_consult` for consultation; caller role/session identity comes from the OpenCode runtime. See [NATIVE_V2_MIGRATION.md](./NATIVE_V2_MIGRATION.md) for role rules, manual model selection, advisor-pool configuration, ledger behavior, and current verification limits.

The native model selector uses current v2 provider/model/integration records and the configured hard-allow pool. Jev failures and low confidence expose eligible caller choices instead of triggering a silent fallback. The advisor pool is configured through `[opencode].manager.advisor_models` and remains intersected with the general model pool. The v2 TUI keeps `/pool`, `/providers`, and `/advisor-pool`; OpenCode owns native agent and task visibility. Legacy task trees, sidebars, BTW controls, and prompt translation are not registered by the native TUI entry.

Live v2 proofs now cover same-session restart, completed-work no-rerun, worker cancellation and department descendant cancellation. The native README is current; archived v1 descriptions remain in `notes/momo-v1-readme.md`. Configured watchdog protection/cap, busy-parent result retry, forwarded-form retry and native shell permission denial have also passed isolated live QA. SDK/CI #30, task engine #31 and manager/catalog #32 are merged into dev. Runtime/consultation #33 is also merged. [Native activation #34](https://github.com/furkanbora239/momo/pull/34) is the final dev delivery gate; check its current GitHub state before starting new work. The final activation bundle passed fresh real v2 parallel, department, caller-selection, all-role consultation, parent question/root escalation and native CLI acceptance; Fresh recovery QA also passed five server restarts, no-rerun, cancellations, busy-parent delivery/form retries and tool watchdog resumption. Main promotion and npm publishing are separate.

Current recovery instructions and the ordered remaining work are in [the native v2 handoff](./notes/native-v2-handoff-20261012.md). Read it before implementation. It records pushed checkpoints, uncommitted worktree changes, real harness evidence, unresolved acceptance gates, and safe test-process handling. Earlier checkpoint counts and pending TUI/search notes are historical; the handoff supersedes them. Codebase Memory MCP remains disabled because automatic freshness failed.

---

## 1. Purpose & North Star

**momo** is a token-efficient, cheap-provider-first agent harness fork of [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) for OpenCode.

- **North Star:** A lightweight orchestrator that plans and delegates aggressively to cheaper subagents. Big models act as bound-on-demand advisors or planners, never default executors.
- **Zero-Config Start:** The OpenCode session model (set via `/models`) is inherited by default. No hardcoded model pinning.
- **Subagent Selection:** Driven at runtime from a live catalog (`catalog_pick`) and user configuration.

---

## 2. Directory Layout & Key Paths

The plugin codebase lives in `packages/omo-opencode/` (not root `src/`):

- `packages/omo-opencode/` — OpenCode plugin (entry: `src/index.ts`)
  - `src/agents/` — Built-in agents (`sisyphus`, `planner`, `worker`, `advisor`, `explore`, `librarian`)
  - `src/tools/delegate-task/` — Task delegation, sync session polling (`sync-session-poller.ts`), stall detection; `decision-router.ts` is the Jev-backed virtual manager
  - `src/features/background-agent/` — Asynchronous background tasks, concurrency, task poller watchdog
  - `src/features/tui-sidebar/` — Real-time TUI sidebar mirror (tracks active agents, sync tasks, background jobs, live tools)
  - `src/features/task-toast-manager/` — Running task tracking and toast notifications
  - `src/hooks/compaction-context-injector/` — Context compaction prompt and session state preservation
  - `src/features/decision-ledger/` — Append-only routing decision ledger (future fine-tune dataset) + export/calibration
- `packages/prompts-core/` — Harness-neutral core prompts (`prompts/planner/default.md`, `prompts/ultrawork/`, etc.)
- `packages/model-core/` — Model requirements and category definitions
- `packages/delegate-core/` — Category-to-model routing policies
- `packages/decision-core/` — Harness-neutral Jev (System One) client + two-stage decision engine

---

## 3. Agent Topology & Roles

All agents start unpinned to any specific provider/model; the user configures models via `/models` or `~/.omo/omo.jsonc`.

1. **`sisyphus` (Orchestrator)**: Mode `all`. Lightweight orchestrator. Inherits current OpenCode session model. Coordinates tasks, delegates to subagents.
2. **`planner` (Planner)**: Mode `all`. High-reasoning planning agent accessible directly via Tab in OpenCode or delegated to by orchestrator. Read-only: gathers context and emits structured plans without modifying code. Checks `PROJECT_STATE.md` first.
3. **`worker` / `sisyphus-junior` (Worker)**: Mode `all`. Dedicated direct execution agent accessible via Tab in OpenCode. Perfect for tasks like `commit and push`, running tests, or single-file edits without orchestrator overhead.
4. **`advisor` (Consultant)**: On-demand advisor gated at task time. Unbound calls are rejected with binding instructions. Bound via `/advisor` command.
5. **`explore` / `librarian` (Discovery)**: Targeted exploration subagents. `explore` for contextual repository grep/search; `librarian` for external docs/web.
6. **`manager` (Tier-2 Dispatcher)**: Since 2026-10-02 this is a **virtual** agent, not an LLM — `task(subagent_type="manager")` routes through the Jev decision engine (see the Jev-Based Virtual Manager milestone in §4). Driven by `manager.decision_engine` (`"jev"` default; `"llm"` restores the legacy LLM manager).

---

## 4. Current Milestone & Completed Work

### Milestone: Architecture Refinement & Reliability (Waves 1-5)

1. **Active Tool Tracking & Stall Watchdog (Dalga 1)**:
   - Fixed subagent hanging unnoticed: 3-minute silence watchdog detects stalled LLMs.
   - Long-running tool protection: Legitimate tools (e.g. `bash` running builds or test suites) are protected up to 60 minutes (`DEFAULT_ACTIVE_TOOL_TIMEOUT_MS = 3600_000`).
   - Fixed sync session poller infinite loop where active session status repeatedly reset stall timer without checking activity signature.

2. **Tab-Switchable Dedicated Agents (Dalga 2)**:
   - `planner` and `worker` enabled with `mode: "all"`, visible and selectable via Tab in OpenCode.
   - Orchestrator starts unpinned to any fixed model.
   - Display name resolution conflict between manager `planner` and legacy `prometheus` resolved.

3. **TUI Sidebar Real-Time Visibility (Dalga 3)**:
   - Fixed subagent display bug where subagents showed as permanently `idle`.
   - `TaskToastManager` running sync tasks integrated into `snapshot-builder` job board and active agents.
   - Running tools displayed in real-time on task cards (e.g., `[Running: bash]`).

4. **Cold-Start Context Savings (Dalga 4)**:
   - Root `PROJECT_STATE.md` established.
   - `planner` and orchestrator instructed to consult `PROJECT_STATE.md` first before any broad directory exploration.

5. **Context Compaction Intelligence (Dalga 5)**:
   - Compaction prompt updated to preserve architectural decisions and current milestone status.
   - Instructs compaction to prune massive raw tool logs/diffs while distilling high-signal facts and referencing `PROJECT_STATE.md`.

6. **CodeGraph Daemon Never-Idle & Synthetic Warmup**:
   - Resolved first-query cold start: Background synthetic probe (`warmupCodegraphMcp`) issues JSON-RPC handshake + `codegraph_status` right after bootstrap, warming up the daemon and SQLite database in ~25ms.
   - Resolved 5-minute idle exit: Configured `CODEGRAPH_DAEMON_IDLE_TIMEOUT_MS=0` and `CODEGRAPH_DAEMON_MAX_IDLE_MS=0` by default so the CodeGraph daemon remains alive and hot across the entire OpenCode session.
   - Config & Schema: Added `auto_warmup` (default `true`) and `idle_timeout_ms` (default `0`) with zero-config defaults and full schema generation.

7. **Prompt Translator (`/caveman`, `/cavemen`, `/c`) & Clean Native Help**:
   - Prompt translator with dual backend: Free Google Gemma via Gemini API (default, zero local resource load) or local Ollama (`qwen2.5:1.5b`).
   - Trigger modes: on-demand via `/caveman`, `/cavemen`, `/c` prefixes or `<caveman-prompt>` tags; or `always` for all prompts.
   - Bypasses `minLength` check when explicitly triggered so short prompts (e.g. `/cavemen test`, `/c bu ne`) are translated and compressed without being skipped.
   - Restored OpenCode native client `/help` command (clean TUI table of available commands without chat prompt injection).
   - Dedicated `/momo` slash command for in-depth interactive AI guide (in Turkish/English).
   - Excluded user-facing slash commands from agent `skill` tool description to prevent agent confusion.
   - Multi-slash command expansion support.

### Milestone: Catalog Cost Control & Reliability (2026-09-14)

- **Provider Catalog Correctness**: The catalog now reconciles against each connected OpenAI-compatible provider's live `GET /models` at startup, refreshes stale caches, and evicts disabled/unavailable providers with health flags, so catalog rows always reflect reality.
- **Model Pool Cost Control**: A hard-allow model pool at `~/.omo/model-pool.json` (managed by the `/pool` TUI panel; empty = allow all) is enforced both in the catalog MCP and at task() time in the delegate-task engine, with fallback-chain rescue. Key files: `src/shared/model-pool.ts`, `src/features/model-pool/`.
- **Catalog Knowledge**: Researched model facts persist to `~/.omo/catalog-knowledge.json` and overlay catalog rows. Key files: `src/mcp/catalog-knowledge-tools.ts`, `src/agents/catalog-researcher/`.
- **Subagent Visibility**: The `/tasks` command (aliases `/agents`, `/subagents`) renders the subagent tree with model id, task, status, and running tool, with prompt detail read from the subagent session store. Key file: `src/features/subagent-tree/`.
- **Sync Reliability**: Producing-aware stall detection with explicit abort reason codes and configurable timeouts; truncated tool output paginable via `/tmp/omo-tool-output`; anchor-aware continuation completion with `no_progress`; `mid_tool_incomplete` flagging. Key file: `src/tools/delegate-task/sync-session-poller.ts`.
 - **Delegation Behavior**: Orchestrator prompts now direct parallel-by-default delegation; manager/executor/planner prompts carry Context Discipline (atomic tasks, minimal context); the opt-in `background_task.nonBlockingByDefault` config makes omitted `run_in_background` resolve to background.

### Milestone: EVREN Provider Limits & Live Capture (2026-09-22)

- **EVREN Context Alignment**: Built-in EVREN models declare a 250k context fallback (matching the published gateway value) and no output cap; OpenCode falls back to its 32k default for output. Key file: `src/features/evren/provider.ts`.
- **Live Limit Capture**: The provider-models live refresh now captures `context_length` / `max_model_len` / `context_window` from `GET /models` (marked `limitSource: "gateway-live-models"` in the cache), and `applyBuiltinEvrenProvider` overrides the injected fallback with those gateway-reported values at config time. The EVREN gateway does not publish these fields yet, so the capture stays dormant until it does. Key files: `src/shared/provider-model-live-refresh.ts`, `src/features/evren/live-context-limits.ts`.

### Milestone: Jev-Based Virtual Manager (2026-10-02)

The Tier-2 manager is no longer an LLM agent. `task(subagent_type="manager")` routes through a two-stage Jev (TypeSafe System One, hosted on OpenCode Zen) decision engine, gated by `manager.decision_engine` (default `"jev"`; `"llm"` restores the legacy LLM manager; `"heuristic"` skips straight to the deterministic `deep` default).

- **Two-stage schema (live-validated on 80 real-style delegations)**: stage 1 asks `path` (7 lanes — measured 95%) + `effort` (score 1-5, MAE 0.82); a deterministic candidate builder injects 4-6 models with real campaign prices into state; stage 2 asks `model` (82.5% with pricing facts vs 55% blind) + `lane` (direct-worker vs department, 100%).
- **Fallback ladder**: confidence gate (default 0.75) → circuit breaker (3 consecutive failures / 10 min) → monthly budget cap → deterministic `{category:"deep"}` with available-model rescue. `task()` never blocks on Jev/Zen outages.
- **Decision ledger**: every decision (questions, answers, full probability distributions, candidates, resolved target, usage) is appended to `~/.omo/decision-ledger.jsonl`, with outcome back-fill — the future fine-tune dataset for momo's own decision model. Export via `script/export-decisions.ts`; threshold calibration via `script/calibrate-decision-threshold.ts`.
- **Key files**: `packages/decision-core/` (Jev client + two-stage engine), `src/features/decision-ledger/`, `src/tools/delegate-task/decision-router.ts` + wiring in `tools.ts`, `src/config/schema/decision-engine.ts`, `src/shared/opencode-provider-auth.ts`.
- **Zen API contract**: `POST https://opencode.ai/zen/v1/systemone`, model `jev-1.13` ($0.042/M input, output free); `criteria` must be a dict (an `options` array is rejected with HTTP 422); keys resolve at call time from the OpenCode auth store (`opencode-go`); Cloudflare rejects generic SDK User-Agents (error 1010).
- **Shipped PRs**: #23 (ledger + config), #24 (decision-core), #25 (virtual manager dispatch), #26 (fine-tune export), #27 (fallback rescue + ledger question fidelity + real outcome status + calibration), #28 (generic `limit.output` fallback).
- **Next**: accumulate ledger data, calibrate the confidence threshold from real outcomes, then fine-tune a local decision model once enough labeled decisions exist.

---

## 5. Working Rules & Constraints

- **Toolchain**: **Bun only** (never npm/yarn/pnpm). Typecheck uses **tsgo** (`bun run typecheck`).
- **Test Gate**: `bun run typecheck` + `bun test` (or `bun test <file>`).
- **No Prompt Contract Assertions**: Never assert authored prompt wording in unit tests; test behavior and routing instead.
- **Cold-Start Discipline**: Always read `PROJECT_STATE.md` before performing repo-wide `find`, `ls`, or `grep` sweeps. Keep this file updated when architecture or milestones change.
- **License**: SUL-1.0 (Sustainable Use License) — keep modified notice identifying this as the **momo** fork.
