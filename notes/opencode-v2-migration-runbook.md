# OpenCode v2 Plugin Migration - Remaining Runbook

Branch: `fix/opencode-v2-plugin-migration` -> PR `dev`. Prereq for live phases: server restart (dist already rebuilt with M1a+M1b+M1f).
Execution rules: after EVERY item run `bun run typecheck` + the focused tests; QA gates use the `opencode-qa` skill (isolated XDG, never the real user DB); until M1e passes use SYNC delegation only (never background); models: hy3 = coding, deepseek-v4-flash = quick/simple, glm-5.3-flash = consult-only (never bulk work).

## Phase 1 - finish the subagent fix
1. **M1d redo (sandbox QA, v2 routes)**: isolated XDG sandbox (recipe in status md) + free port; start `opencode serve`; verify health via a REAL v2 route (`/api/...`) and plugin-load lines in serve.log; create parent via `POST /api/session`; prompt parent (v2 prompt route) to spawn 5 parallel background tasks (category quick, model opencode-go/deepseek-v4-flash, prompt: read README.md -> 3-line summary); wait ~115s; dump `GET /api/session` + per-session messages. PASS = 5/5 children produced real summaries AND serve.log has `gone from status` = 0, `Step interrupted` = 0, `degrading to no-op` = 0 for child sessions; any attribution log line (`evidence source`) must name a terminal reason. Evidence to `.omo/evidence/20261004-p2-poller/`.
2. **M1e (live validation)**: after user restarts, run 3 parallel background delegations in the real TUI (2 quick deepseek + 1 hy3); all must run to genuine completion with zero kills; optional informational probe: repeat once from a Plan-mode parent (closes the plan-mode hypothesis).
3. **M1g (resume path)**: verify `task(task_id=...)` continuation still works end-to-end after M1f (one real resume cycle).

## Phase 2 - tool surface / permissions (P1)
4. **M2a**: re-derive `launchTools` / `getAgentToolRestrictions` against V2 semantics - V1 prompt `tools` deprecated -> session-level permissions (deny removes the tool from the surface); apply renames bash->shell, task->subagent, write/patch->edit. Files: `src/shared/session-tools-store.ts`, `src/shared/permission-compat.ts`, delegate-task engine call sites.
5. **M2b**: per-agent permission maps for the kept roster; sandbox assert the child tool surface equals the expected set.
6. **M2c - tool-call pathway spec (deliverable for the PROMPTS the user writes themselves)**: per-agent allowed tool names under V2 naming, prompt snippets referencing `shell`/`subagent`/`edit` (never bash/task/write), permission frontmatter examples for the native markdown agents of Phase 3. This is the ONLY prompt-content item in this plan.

## Phase 3 - native markdown agents (decision D3)
7. **M3a**: author `.opencode/agents/*.md` for the kept roster (worker, explore, librarian, research, planner, executor, reviewer, advisor, catalog-researcher): frontmatter description/mode/permissions, NO model field (preserve `/models` inheritance); variant routing stays engine-side (`sisyphus-agent-factory` resolves from session model).
8. **M3b**: plugin stops registering overlapping agents (keep only engine-coupled ones: advisor gate, catalog-researcher); ship markdown agents via npm `files` like skills.
9. **M3c**: sandbox QA - agents appear in the native panel, permissions enforced, no model pinned, session-model inheritance intact.

## Phase 4 - cleanup & closure
10. **M4 (D1 legacy quarantine)**: move v1-dead parts to `src/legacy/` with a banner README (retained-not-deleted, known-dead-under-v2); no imports from live code; typecheck green; includes the dead `sessionGoneTimeoutMs` fixture field cleanup.
11. **M5 (D2)**: retire the `/tasks` panel (native Alt agents panel takes over); keep `/pool` and `/provider`; TUI toasts via `@opencode/plugin/tui`; update tests.
12. **M6 bridge sweep** (one item at a time, grep+test evidence each): system override -> `ctx.session.hook("context")`; map `session.execution.interrupted` in event-hook-bridge; parent-wake fix; live-server-route; prompt-async-gate holdMs anomaly (~3.3s vs 15000); `session.todo` mapping.
13. **M7 standing QA infra**: sandbox provider cache seed (fixes the empty-child P3), `--self-test` driver script wrapping the M1d pattern, standing regression exam (5-parallel survive + tool surface + no verdict-noise regressions).
14. **M8 closure**: update `PROJECT_STATE.md` + `AGENTS.md` recent-updates + PR body; open PR `fix/opencode-v2-plugin-migration` -> `dev` with the gate numbers from the status md.

Ordering: 1->3 strictly first; 4-6 next; 7-9 after M2c (frontmatter permissions come from it); 10-14 last.
