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

## Wave 2 (2026-10-05) - tool surface, question routing, QA infra

### M2a - V2 tool surface derivation (done)
- Centralized V1->V2 rename (`normalizeToolName` / `normalizeToolRecord` in `src/shared/agent-tool-restrictions.ts`) applied at 6 surface boundaries; deny = remove-from-surface (`deriveRemovedToolNames` / `deriveAllowedToolNames` in `src/shared/session-tools-store.ts`); worker read-side baseline (`codegraph_*`, `skill`, `websearch`, `webfetch`) added to the execution-agent allow-set (the `momo_nots.md` 8.1 request).
- Tests rewritten to V2 semantics (7 renamed case pairs, no coverage lost) + 4 new session-tools-store cases. Gate at wave-1 merge: typecheck 0, delegate-task+v2 803/0.

### M2b - per-agent permission maps + sandbox surface assert (done)
- NEW `src/shared/agent-tool-surface.ts` = single source of truth (`PER_AGENT_TOOL_SURFACE`); the QA manifest `script/qa/opencode-v2-qa-tool-surface.json` is GENERATED from it (`script/qa/gen-agent-tool-surface.ts`) with a drift-guard test. Worker `requiredPresence` promoted to a hard gate.
- Live gate split: `livePresenceGate` = `[websearch, webfetch]` only, because the sandbox cannot surface `codegraph`/`skill` to the model (OpenCode MCP->model wiring) - code-level presence is still asserted. Real sandbox run PASS: observed child surface `{read, shell, webfetch, execute, websearch}`, zero removed tools present.

### M2c - tool-call pathway spec (done)
- `notes/tool-call-pathway-spec.md` (318 lines): V1->V2 name map, per-agent surface tables (synced to `PER_AGENT_TOOL_SURFACE`), V2 prompt snippets, Phase 3 permission frontmatter examples, common mistakes, plus the `task(task_id, answer)` question-routing pattern.

### M2d - question routing (worker -> orchestrator) - IN PROGRESS
- Code + unit tests landed: `src/features/background-agent/subagent-question-router.ts`, `manager.ts` (`routeChildQuestion` / `answerChildQuestion` / `escalatePendingQuestionToUser` / `resolveRootUserSessionId`), delegate-task `answer` parameter. Unit gates green (router 8 + routing 7 cases), typecheck 0 at implementation time.
- Live exam attempts: #1 VACUOUS (the exam never bound a child - response-shape parsing bug, since fixed); #2 = `taskId bg_4bb91c42`, `child ses_ef3567507ffepCYv06T0CC1JjZ`: **assert1 routedToOrchestrator TRUE, assert2 noEarlyEscalation TRUE**, assert3 childContinuedWithAnswer FALSE, assert4 escalatedToUser FALSE.
- Root cause under fix at day end: the routing notification is deferred by the parent-wake active-defer (parent never sees it promptly, answer never lands, escalation never fires). Fix in flight: a `deliverImmediately` bypass across the parent-wake chain (`parent-wake-pending-queue.ts`, `parent-wake-notifier.ts`, `parent-wake-flush-runner.ts`, `manager.ts`).
- Evidence: `.omo/evidence/20261005-m2d-question-routing/`.

### M6 bridge sweep - 2 of 6 items done
- `session.execution.*` lifecycle mapping in the status registry derive table: `started`->busy, `succeeded`->idle, `interrupted`->interrupted (terminal), `failed`->error. Interrupts are now positive terminal evidence for the classifier gate (`manager.ts` terminal check).
- `session.todo` mapping: landed as the **`todo.updated`** mapping (there is no `session.todo` event) via NEW `src/v2/todo-registry.ts` mirroring the M1a registry pattern; the client bridge now serves todos instead of logging no-op. **Live emission UNCONFIRMED** (pinned `@opencode/client`/`protocol` 2.0.22 types lack the event; installed opencode is 2.0.23) - needs a restart + one real `todowrite`.

### M7 - standing QA infra (done)
- `script/qa/`: `opencode-v2-qa-seed.ts` (provider cache seed - closes the sandbox empty-child P3), `opencode-v2-qa-driver.ts` (`--self-test` / `--full` / `--regression`), `opencode-v2-qa-exam.ts` (standing regression exam), `opencode-v2-qa-tool-surface.json` + `gen-agent-tool-surface.ts`, `opencode-v2-qa.md`. Self-test and exam PASS. Evidence: `.omo/evidence/20261005-m7-qa-infra/`.

### Day-end gates (2026-10-05)
- Full `packages/omo-opencode/src/` suite: **9280 pass / 2 skip / 17 fail**. Of the 17: 8 catalog MCP (env-dependent, documented bar), 2 `createBuiltinAgents`, 1 markdown link audit (`README.md:6`) = documented pre-existing; plus 6 pre-existing failures whose producers and tests this work never touched (`git diff HEAD` empty on those paths) - 3 CLI/TUI installer + 2 `createPluginModule` (`tui.json` entry never written) + 1 `claude-code-agent-loader` - consistent with the earlier V2 migration commits (dual-export, TUI entry rewiring). Decide at M8: document in the PR body or fix in a follow-up.
- `dist/` rebuilt with wave-2 content (M2d routing, M6 todo registry, M2b baseline verified present in the bundle).
- **Sync transport (old engine)**: children do NOT start on dispatch (3/3 parked); a resume kick `task(task_id, "Proceed ...")` starts them immediately. Sync never interrupts, but verdicts are unreliable (both flavors fixed in M1f, live only after restart).
- **Background transport (old engine)**: kill storm active until server restart - do not delegate background until M1e passes.
- Verdict texts: `Session error: Step interrupted` on collection = killed child; `Task incomplete (reason: mid_tool_incomplete)` = child still running, use task_id resume.
- Plugin QA harness: `opencode-qa` skill `common.sh --self-check` = 6/7 (only `oqa_db_path` FAILs; irrelevant for server QA, matters for Case D DB reads).
- tmux driver scripts: never embed single quotes inside a single-quoted `tmux new-session` command string (broke first M1d launch silently).
- First independent M1d-era test snapshot caught 2 M1b test failures mid-edit of the child - always re-run gates AFTER the child reports completion.
- `sessionGoneTimeoutMs` remains as a dead config field in test fixtures (production no longer reads it) - M4 cleanup candidate.
- Open, low-value: plan-mode-vs-coding-mode survival hypothesis (the mechanism is timing-lottery; close with one Plan-mode-parent probe after restart if desired).
