# OpenCode v2 Plugin Migration - Status & Notes

Branch: `fix/opencode-v2-plugin-migration` (PR target: `dev`). Updated: 2026-10-05.
Plugin load path: `file:///Volumes/harici_ssd/code/ai/momo/dist` (from `~/.config/opencode/opencode.json`), so the RUNNING server executes the OLD in-memory bundle until restart. `bun run build` completed green (FINAL=0, dist/index.js 7.1 MB / 2239 modules) with all fixes below included.

## Done (code-landed, independently verified)

### M0 - Forensics (root causes pinned with log + code evidence)
- **P2 kill storm**: under V2 the plugin ctx has no session status API; `session.status()` was a logged no-op -> `allStatuses = {}` -> every child judged "gone from status" at the first post-output 3s poll sweep -> `tryCompleteTask` cleanup interrupted + deleted LIVE child sessions (server side showed interrupt reason `user` then `session.deleted`). Timing lottery: children whose first valid output arrived before a sweep died at ~3s; late-output or sub-3s tasks survived (morning: 15/15 killed; evening: 3/3 survived with unchanged code).
- **P1 tool surface**: V2 deprecated prompt-level `tools` (converted to permissions; deny removes tools) plus renames bash->shell, task->subagent, write/patch->edit; momo `launchTools` / `getAgentToolRestrictions` need re-derivation (Phase 2).
- **P4 sync verdicts**: two false-verdict flavors in the sync path (see M1f).

### M1a - V2 session-status registry
- New: `packages/omo-opencode/src/v2/session-status-registry.ts` (+ test, 7 cases) - `createSessionStatusRegistry()` with `feed/get/map/clear`, fed from `event-hook-bridge.ts` via `ctx.event.subscribe` for every `session.*` kind; single shared instance created in `plugin-definition.ts`, threaded through `hook-bridge.ts` and `client-bridge.ts` into `session-client-bridge.ts` where `session.status()` now returns registry data (no-arg -> full map, requested id -> entry; no entry -> old no-op log). Bridges were NOT otherwise touched.
- Gates: new test 7/0, existing v2 bridge tests 18/0, typecheck 0.

### M1b - background poller/manager kill-storm fix
- `features/background-agent/task-poller.ts`: absence from a provided status map = UNKNOWN -> keep waiting (debug log); removed the `sessionGone` absence-interrupt path (`checkSessionExistence`, `MIN_SESSION_GONE_POLLS`, `sessionGoneTimeoutMs` usage); `interruptStaleTask` now logs attribution (task id, session id, reason, evidence source).
- `features/background-agent/manager.ts`: `pollRunningTasks` completes only on positive terminal evidence (registry terminal status, or idle corroborated by valid output); mid-flight output is NOT completion evidence; attribution logs added at every interrupt/delete site.
- Tests: task-poller.test.ts 4 new M1b cases + 7 updated old-behavior cases; manager.polling.test.ts, manager.polling.session-status-unavailable.test.ts, manager.test.ts updated to the new behavior.
- Hardened call sites: `task-poller.ts:162` (interruptStaleTask attribution), `manager.ts:2390` (cancelTask), `manager.ts:2568` (tryCompleteTask cleanup - the former kill-storm delete site), `manager.ts:3143` (shutdown); terminal gate at `manager.ts:3061-3072`.
- Gates (independent runs): 4 touched files 260/0, full background-agent suite 750/0 (59 files), typecheck exit 0.

### M1c - absence-branch sweep (verdict: clean)
- Production `sessionStatuses` consumer is only task-poller.ts (now UNKNOWN->wait). `manager.ts:1912` `if (!sessionID || !status?.type) return` is a safe early return. `manager.ts:1847-1894` cancel on `session.deleted` is positive terminal evidence (legitimate). No remaining absence-conditioned interrupt/abort/delete in production code.

### M1f - sync poller false-verdict fix
- `tools/delegate-task/sync-session-poller.ts`: FLAVOR-1 (early "completed" parking) - completion now requires `isSessionComplete` (finalized message, no pending tool parts, correct turn order) PLUS positive idle confirmation; absent/empty status = UNKNOWN -> keeps polling, completes only when the session has "settled" after `STALL_TIMEOUT_MS` with no new activity. FLAVOR-2 (`mid_tool_incomplete` noise) - text emitted while a tool is pending keeps polling; escalates to `mid_tool_incomplete` + `abortSyncSession` only after the inactivity window expires (task_id resume remains the fallback). Active-branch stall/abort safeguards untouched.
- Tests: sync-session-poller.status-fallback.test.ts (3/0), sync-session-poller.mid-tool.test.ts (3/0), tools.test.ts mock fixed (empty status -> real idle).
- Gates (independent run): delegate-task suite 618/0 (52 files), typecheck exit 0.

## M1d attempt #1 - FAILED harness (vacuous zeros, NOT a pass)
- Driver used v1-era routes from the QA reference (documented for v1.15/1.17): `GET /global/health` returned the SPA index.html (catch-all), `POST /session` returned nothing parseable -> `SES=` empty -> parent never created -> NO children ever spawned. The all-zero grep counters in `/tmp/qa-m1d/greps.txt` are therefore meaningless.
- Lessons: this server is V2 - use `/api/*` routes (`POST /api/session`, prompt routes, `GET /api/session/:id/message`; confirmed alive on the real server earlier), Basic auth `opencode:<password>` (password in `~/.config/opencode/service.json`), pick a verified-free port, assert `SES` is non-empty and plugin-loaded lines appear in serve.log BEFORE prompting, then assert children exist before interpreting any log counters.
- Sandbox recipe that DID work: isolated `XDG_DATA_HOME/XDG_CONFIG_HOME/XDG_STATE_HOME/XDG_CACHE_HOME` temp dirs + copy `~/.config/opencode/opencode.json` to `$XDG_CONFIG_HOME/opencode/opencode.json` + copy `auth.json` to `$XDG_DATA_HOME/opencode/auth.json`. Model pool `~/.omo/model-pool.json` allowlists `opencode-go/deepseek-v4-flash` (task-time enforcement OK).

## Operational notes (gotchas learned the hard way)
- **Sync transport (old engine)**: children do NOT start on dispatch (3/3 parked); a resume kick `task(task_id, "Proceed ...")` starts them immediately. Sync never interrupts, but verdicts are unreliable (both flavors fixed in M1f, live only after restart).
- **Background transport (old engine)**: kill storm active until server restart - do not delegate background until M1e passes.
- Verdict texts: `Session error: Step interrupted` on collection = killed child; `Task incomplete (reason: mid_tool_incomplete)` = child still running, use task_id resume.
- Plugin QA harness: `opencode-qa` skill `common.sh --self-check` = 6/7 (only `oqa_db_path` FAILs; irrelevant for server QA, matters for Case D DB reads).
- tmux driver scripts: never embed single quotes inside a single-quoted `tmux new-session` command string (broke first M1d launch silently).
- First independent M1d-era test snapshot caught 2 M1b test failures mid-edit of the child - always re-run gates AFTER the child reports completion.
- `sessionGoneTimeoutMs` remains as a dead config field in test fixtures (production no longer reads it) - M4 cleanup candidate.
- Open, low-value: plan-mode-vs-coding-mode survival hypothesis (the mechanism is timing-lottery; close with one Plan-mode-parent probe after restart if desired).
