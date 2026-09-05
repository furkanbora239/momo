# PROJECT_STATE.md — momo (My Oh My Openagent)

**Last Updated:** 2026-09-05  
**Version / Branch:** `dev`

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
  - `src/tools/delegate-task/` — Task delegation, sync session polling (`sync-session-poller.ts`), stall detection
  - `src/features/background-agent/` — Asynchronous background tasks, concurrency, task poller watchdog
  - `src/features/tui-sidebar/` — Real-time TUI sidebar mirror (tracks active agents, sync tasks, background jobs, live tools)
  - `src/features/task-toast-manager/` — Running task tracking and toast notifications
  - `src/hooks/compaction-context-injector/` — Context compaction prompt and session state preservation
- `packages/prompts-core/` — Harness-neutral core prompts (`prompts/planner/default.md`, `prompts/ultrawork/`, etc.)
- `packages/model-core/` — Model requirements and category definitions
- `packages/delegate-core/` — Category-to-model routing policies

---

## 3. Agent Topology & Roles

All agents start unpinned to any specific provider/model; the user configures models via `/models` or `~/.omo/omo.jsonc`.

1. **`sisyphus` (Orchestrator)**: Mode `all`. Lightweight orchestrator. Inherits current OpenCode session model. Coordinates tasks, delegates to subagents.
2. **`planner` (Planner)**: Mode `all`. High-reasoning planning agent accessible directly via Tab in OpenCode or delegated to by orchestrator. Read-only: gathers context and emits structured plans without modifying code. Checks `PROJECT_STATE.md` first.
3. **`worker` / `sisyphus-junior` (Worker)**: Mode `all`. Dedicated direct execution agent accessible via Tab in OpenCode. Perfect for tasks like `commit and push`, running tests, or single-file edits without orchestrator overhead.
4. **`advisor` (Consultant)**: On-demand advisor gated at task time. Unbound calls are rejected with binding instructions. Bound via `/advisor` command.
5. **`explore` / `librarian` (Discovery)**: Targeted exploration subagents. `explore` for contextual repository grep/search; `librarian` for external docs/web.

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

---

## 5. Working Rules & Constraints

- **Toolchain**: **Bun only** (never npm/yarn/pnpm). Typecheck uses **tsgo** (`bun run typecheck`).
- **Test Gate**: `bun run typecheck` + `bun test` (or `bun test <file>`).
- **No Prompt Contract Assertions**: Never assert authored prompt wording in unit tests; test behavior and routing instead.
- **Cold-Start Discipline**: Always read `PROJECT_STATE.md` before performing repo-wide `find`, `ls`, or `grep` sweeps. Keep this file updated when architecture or milestones change.
- **License**: SUL-1.0 (Sustainable Use License) — keep modified notice identifying this as the **momo** fork.
