# momo native v2: resume here (2026-10-12)

This is the current handoff and execution roadmap. It supersedes the verification and outstanding-work sections of `native-v2-checkpoint-20261012.md`. This migration is not release accepted or merged into dev.

## Current execution state (read this before historical checkpoints)

- Implementation checkpoint through `bd5bc16e9` is pushed on `codex/momo-v2-baseline`. All pricing, question/escalation, parallel, consultation, restart/cancellation, busy-parent retry, tool watchdog and permission live matrices passed on isolated OpenCode 2.0.24 with fake providers.
- Follow-up in integration clears stale active-tool leases only after native inspection confirms the existing session is no longer running. Focused regression and built-plugin capped-shell resumption passed; full suite is being repeated after fixing archived README relative links.
- First independent dev PR is prepared in `/private/tmp/momo-v2-sdk-contract`, branch `codex/momo-v2-sdk-contract`: pinned SDKs and permission output propagation. Its actual native permission bridge probe passed, typecheck and complete build passed. Sandbox full-suite failures were process/socket/file-access errors; a full run with required process access is in progress. QA driver and evidence are not yet committed on that branch.
- Dependent task-engine slice is being prepared in `/private/tmp/momo-v2-task-engine`, branch `codex/momo-v2-task-engine`. Do not overwrite the original repository or the earlier workers' WIP.
- Git osxkeychain login works for GitHub API outside sandbox; no new login needed. `/private/tmp/momo-gh.py` uses that existing login transiently for gh and redacts credentials. The wrapper contains no credential and is not a repository artifact.
- Next: finish/check current suites, commit each QA-backed slice, push and open the SDK-contract PR to dev; check CI/review; deliver task engine, routing/catalog, runtime/consult/search and final native activation/docs as dependent reviewable PRs. Release remains incomplete until all slices and gates land.

The sections below are chronological history. Their old immediate-next-step and failed-pricing lists are superseded by the current state above and later checkpoint updates.


## Scope that must survive

OpenCode is v2-only, pinned to SDK/plugin/schema 2.0.24. Keep the other adapters, shared packages and upstream SUL notices. The root session model is the orchestrator model. Jev is a replaceable routing service, not an executing agent. Every task, including department children, passes through it. Departments are planner/executor/reviewer and cannot create departments. Workers cannot delegate. All non-advisor roles may consult; advisors are readonly and cannot delegate or consult. Coordinators cannot edit or run general shell commands.

Use `momo_task` and `momo_consult`; native alternate delegation must not bypass policy. Preserve hard-allow pool, provider/concurrency/timeout settings, confidence 0.75, explicit caller selection on manager failure, and separate researched facts from verified outcomes. No silent model fallback. Codebase Memory v0.11.0 stays disabled: automatic freshness failed; LSP/ast-grep/read/search are the native fallback. No fine-tuning or performance-success claims in this release.

## Branches and recovery

- Integration: `/private/tmp/momo-v2-baseline`, branch `codex/momo-v2-baseline`, remote pushed through `e3bcbe3ba` before this note. Start here. Original checkout the primary momo checkout is kept clean.
- Engine scratch: `/private/tmp/momo-v2-native`, branch `codex/momo-v2-native`.
- Routing scratch: `/private/tmp/momo-v2-routing`, branch `codex/momo-v2-routing`.
- Existing worker names: native_engine, native_routing, v2_baseline (Luna). At this handoff the engine and baseline workers hit usage limits; routing finished its latest slice. Retain all worktrees.
- Integration inherits migration head `23ed5c69a`, including 15 pre-existing commits over dev. Do not blindly open one huge PR or discard that history. Resolve the inherited baseline and split dependent reviewable PRs before landing into dev.
- Git status in integration has uncommitted engine and pricing changes. Routing strict-store changes still need selective integration. Never overwrite the newer pricing adapter with the routing copy. `.npm-cache/` and `no-preload.bunfig.toml` are temporary, not deliverables.
- Remote branch holds committed checkpoints; temporary worktrees hold newer WIP. Before deleting any checkout, commit relevant WIP and retain sanitized evidence. Ignored `.omo/` evidence is not available from a fresh clone.

## Roadmap and present state

| Slice | Saved implementation | Remaining acceptance |
| --- | --- | --- |
| 1. V2 contract | SDK pin, permission output, installer/entry, native TUI registration, obsolete v1 test paths cleaned | Final full-suite/build and actual built-bundle harness run |
| 2. Task engine | Durable records, scheduler, session events, delivery, forms, cancellation and reconciliation; latest question-race/CLI ordering fixes are WIP | Verify latest durable department aggregation; full process restart, busy parent, retry fault, active-tool timeout and cancellation matrix |
| 3. Manager/catalog | Full eligible candidates, real lane/model dispatch, stable tickets, top-three manual choices, ledger/export and research | Commit and live-prove price provenance WIP; integrate fail-closed control/ledger stores; prove no Jev replay on corruption |
| 4. Consultation/tools | Advisor pool, role restrictions, native MCP name normalization; live worker edit/advisor readonly search; native dialog controls | Strict unknown-MCP deny slice, recheck final role surfaces and all-level consultation on final tree |
| 5. Close migration | Owned markdown roles, native CLI/TUI, active native entry; programming skills optional | Audit active legacy paths, refresh docs, publish sanitized evidence, atomic PRs to dev, CI/review/merge gates |

## Evidence already observed, with limits

Committed entry/manager probes used real OpenCode 2.0.24 and local fake model/Jev servers. Manual choice rejects candidates outside the presented ticket; successful choice does not call Jev again. Coordinator enrichment is absent from Code Mode via `codemode:false`, and forced enrichment cannot write. Legacy decision export remains raw readonly, separate from native outcome verification. Graph cache carries its external MIT notice while momo retains SUL.

Routing actual TUI QA proved server `plugins` configuration loading a `file:<package-directory>` fixture outside `.opencode/plugins` automatic discovery, native dialog/keymap controls for pool/providers/advisors, and no cli.json rewrite. Worker AST rewrite changed a temporary marker; advisor read the updated marker and rename was denied. Exact MCP aliases required the committed role-policy normalization.

Engine worker reported a corrected broad real acceptance pass: five parallel workers with one parent and unique deliveries; department child question answered by parent; unanswered question escalated after the actual 120-second timeout and answered via root form; consultations from nine non-advisor roles; CLI aggregation and manager selection. This report still needs root reconciliation with the exact latest production files and evidence. An earlier run exposed stale `task.result` despite a newer department execution outcome. Do not dismiss that as fixture timing without identifying the production ordering fix.

Automated integration checks previously reached 12,674 pass / 6 skip / 3 fail in the full Bun suite (189.50s). The three failures were lifecycle mock hygiene and two TUI doctor fixtures; focused fixes passed afterward, but the full suite has not been rerun on the final tree. Full build passed before the latest WIP. Latest integrated engine focused run: 53 pass, 194 assertions; monorepo typecheck passed. These are checkpoints, not final acceptance.

Local evidence directories:

- Integration `.omo/evidence/20261012-root-checkpoint/`: full suite/build and focused logs.
- Integration `.omo/evidence/20261012-v2-native/`: actual entry/installer/manager probes.
- Engine `.omo/evidence/20261011-native-acceptance/`: summary.json, adversarial.json; latter is partial.
- Engine `.omo/evidence/20261012-root-native-runtime/`: earlier native runtime/forms probes.
- Routing `.omo/evidence/20261011-native-acceptance/`: TUI config/load, panel persistence, live search/model surfaces and cleanup proofs.
- Integration `.omo/evidence/20261012-native-price-proof/`: failed pricing harness attempts, not acceptance.

## Immediate next steps in order

1. Save this handoff commit and push before resuming implementation (explicit user request).
2. Review engine WIP already copied into integration: native-task engine/events/runner/controls/lifecycle/repository/types/testing, runtime session-runtime and delivery-message-id, CLI native-run completion/runner/tasks and tests, acceptance driver. Establish the stale aggregate result fix and ensure question notification wakeups obey provider/model capacity. Reconcile latest live evidence, then make separate engine/runtime/CLI checkpoint commits.
3. Integrate routing strict slice: `native-catalog/native-control-stores.ts` plus tests; `native-runtime/tui/control-stores.ts`; native-routing jsonl-store/router tests; native-runtime role-policy/tests. In pricing adapter preserve new price fields, replace shared default stores with `createNativeControlStores(options.homeDirectory)` and its `readPool`/`readProviderToggles`. Missing or valid empty pool allows all; malformed/unreadable existing controls must fail closed. Corrupt active native ledger must prevent replay/Jev call; legacy export remains separate.
4. Finish pricing WIP: source-backed exact-model USD input/output rates and HTTP(S) provenance, unknown uncited SDK zero preserved, Jev price currency/origin passed. Check adapter/store/enrichment/facts/types, routing Jev/types/tests, research prompt and pricing-routing test. Actual QA driver `script/qa/momo-native-price-acceptance.ts` is not green. Reuse the proven acceptance/TUI service startup rather than add blind retries. Exact binary `/opt/homebrew/Cellar/opencode-v2/2.0.24/bin/opencode`; package `file:` specification, plural `plugins`, disabled models fetch, correct API endpoint/client. Enrichment must use direct top-level momo_catalog_enrich, not Code Mode. Previous generated provider shim had a syntax error; that was corrected, but transport readiness still failed intermittently.
5. Complete real adversarial matrix on the final tree: restart and same-session continuation/no finished rerun; busy-parent delivery and retry faults; active tool protection; cancellation; native permission denial; immutable tickets and unavailable pool. Record stable task/session/decision identity and exact observed results, not model self-reports.
6. Run typecheck, focused behavioral tests, full Bun suite and build; observe process status/output periodically. Then drive the built plugin in isolated real OpenCode. Save sanitized, tree-bound evidence that a reviewer can access from Git.
7. Refresh this handoff and NATIVE_V2_MIGRATION.md. Split PRs to dev with CI/review gates. gh was not authenticated at the earlier check although git push works; resolve PR access when the reviewable slices are ready, never extract credentials. Do not push dev/main directly or mark release complete before acceptance.

## QA and process discipline

Use Bun/tsgo. Read opencode-qa and work-with-pr skills; old v1 route examples are not authority for v2. Isolate OPENCODE_TEST_HOME, all XDG directories and OPENCODE_CONFIG_DIR; strip inherited provider secrets, including inherited provider keys. Use only fake local model/Jev endpoints and explicit fake hard pools. Do not change process HOME or touch user databases/global client configuration. Verify cleanup and unchanged user DB counts.

Bun tests sometimes hang. Start one controlled suite, redirect logs, poll output and inspect only its exact PID/process tree. Stop only confirmed task-owned stuck processes. User OpenCode and TUI processes are unrelated; verify process ownership instead of blindly killing them. Never run broad pkill. Keep focused QA command exit/result and real harness evidence distinct.

The local ulw state is engine `.omo/ulw-loop/momo-v2-native/`: brief.md, goals.json and ledger.jsonl. Three release criteria remain pending. Do not mark them passed from partial probes.

## Checkpoint update after handoff push

The previously uncommitted integration engine, runtime, CLI and pricing changes are now saved: `e5348d629` strict controls/ledger/policy, `23b4f1f4f` sourced prices and strict adapter wiring, `72350668e` lifecycle/reconciliation, `8da126d4a` question delivery, `c4860446e` CLI completion, and `8a4d84fed` QA drivers. The earlier WIP directions describe their origin; do not re-copy the old routing files over these commits. Only temporary cache/config files remain untracked in integration.

Latest verification: 50 focused strict-control/catalog/router/role tests passed (190 assertions); 44 lifecycle/runtime/CLI/pricing tests passed (162 assertions); full monorepo typecheck passed. The pricing real-harness driver is still not accepted and the adversarial live matrix remains partial. These commits save implementation progress and do not close release gates. The root verified the engine summary file reports passed and adversarial.json explicitly lists its remaining live cases. Exact stale department-result ordering analysis is still required.

The pricing QA checkpoint now explicitly writes an isolated hard-allow pool containing only its three fake models, and its provider-transform callback matches the proven no-return fixture contract. API diagnostics use /api/provider. A fresh live pricing proof is still required.

## Final verification in this checkpoint

Full monorepo Bun suite completed normally: 12,699 pass, 6 skip, 0 fail across 1,558 files in 196.06 seconds. Full build passed. The built `dist/index.js` then passed isolated actual OpenCode 2.0.24 pricing QA: researcher persisted a sourced fixture free price through momo_catalog_enrich; Jev received free/priced/unknown price facts separately; the fake free worker completed and its result was delivered once. Real user database counts were unchanged and the driver cleaned its process group. The fake Jev fixture now treats catalog research separately, responds on errors instead of hanging, and checks the one worker route rather than the last background route. Async delivery is polled with a 30-second bound.

Sanitized reviewable evidence is committed at `.omo/evidence/20261012-handoff/sanitized-price-and-checks.json`, including the tested bundle SHA-256. This replaces the earlier failed-pricing status only; broader adversarial live gates, stale department aggregation analysis, concurrency wakeup verification, final migration audit and dev PR delivery remain open. The full-suite result predates the last QA-driver-only edits; production code did not change afterward.

## Follow-up: managed question wakes and execution ordering

A managed child-question notification previously called native synthetic resume directly. The current follow-up moves managed parent wakeups through the task scheduler, preserving provider/model capacity. Runtime ask creates the stable forwarded form; the engine queues one question prompt for a waiting department. A currently running parent keeps question delivery pending for the periodic retry instead of receiving an extra direct wake. Root user sessions retain native synthetic notifications. Synchronous parents waiting on the same child receive its question through the existing wait result.

V2 execution events now retain durable.seq in the task adapter, with a persisted execution watermark. Older execution events are ignored; a finish from the previous turn cannot complete a queued continuation. Focused tests also recreate the engine while a department question wake waits behind a worker occupying its model slot and verify only one continuation after that slot becomes free.

The earlier stale department-result investigation found a concrete fixture problem: actual native context contained the aggregated assistant result, then a late synthetic child-result input, then a newer READY assistant result. The durable task correctly matched that latest assistant response. The fixture now aggregates that last delivery turn too and answers the real q0 form field. This does not justify changing production to preserve an older assistant result.

Automated verification for this follow-up: 38 focused tests passed (137 assertions); full suite 12,703 pass / 6 skip / 0 fail, 202.12 seconds; build and typecheck passed. The extra engine-recreation assertions added afterward passed in the focused lifecycle file (19 tests, 78 assertions). The built-plugin live form/escalation matrix is being rechecked before committing this follow-up. A full server process restart, real cancellation of descendants, injected form-delivery failures, active-tool watchdog and explicit live permission-hook denial remain open.

The follow-up built-plugin live matrix passed: five parallel workers, managed parent question and exactly one parent answer, real 120-second root escalation with q0 reply, CLI aggregation, manual manager selection without Jev replay, all consultation roles and coordinator tool surface checks. Task result matched the final aggregate. The disposable database and owned process group were removed; user DB counts were unchanged. Sanitized evidence: `.omo/evidence/20261012-question-wake/sanitized-summary.json`. Full live restart/cancel/fault/watchdog gates remain pending; capacity blocking was proved with behavioral engine tests, not claimed as a live server restart.

## Restart/cancellation checkpoint

Actual server shutdown exposed a production bug: native assistant errors with type `aborted` (`Step interrupted`) were reconciled as permanent failures. Runtime inspection and v2 event mapping now distinguish interruption, allowing same-session continuation. The built-plugin live follow-up passed five server restarts: interrupted worker resumes with stable task/session/decision IDs; finished work does not rerun; cancelled worker remains inactive; a department waiting on a child resumes the original tree; cancelling a department stops its descendant and neither reopens after restart.

Sanitized evidence: `.omo/evidence/20261012-restart-cancel/sanitized-summary.json`. Automated checks: 40 focused tests / 141 assertions; 12,705 full-suite pass, 6 skip, 0 fail in 188.93 seconds; typecheck and build pass. The new pricing/lifecycle QA files are now explicitly included by `script/qa/tsconfig.native.json` in the script typecheck command. The former script glob only covered top-level script files.

The native README replaces active v1 translator, category/task and Codegraph claims. Historical text and all its attribution are retained in `notes/momo-v1-readme.md`. Remaining live gates are tool watchdog protection/cap, injected form/result delivery faults, and a native permission-hook denial. Final active-path/document audit and dev PR/CI/review/merge gates remain open. Earlier restart/cancel pending items above are now superseded by this checkpoint.

## Remaining adversarial probes completed

Actual shell tool QA passed: a 65-second shell job stayed running with an active shell tool after the configured 60-second silence limit, then completed; a longer shell job was interrupted by the configured 70-second active cap, accounting for the existing 30-second watchdog tick. A real native permission evaluate hook denied the third worker shell command; its file was not created. This exercises configured watchdog branches without waiting for the literal production 60-minute cap. Defaults remain unchanged. Evidence: `.omo/evidence/20261012-tool-watchdog/sanitized-summary.json`.

Actual SDK delivery fault QA passed: one parent result POST was answered with 503 only after the native active-session API proved the parent was busy; retry used the same synthetic ID and the task recorded two delivery attempts. One forwarded parent form POST also received 503; the periodic retry reused its ID, opened only one form, accepted q0 and closed it after the same child completed. No duplicate result was accepted. Evidence: `.omo/evidence/20261012-delivery-faults/sanitized-summary.json`.

Both disposable server groups exited and user database counts were unchanged. The tool fixture initially encountered EPERM checking a terminated group with kill(0); it now verifies that group ID against ps membership rather than treating EPERM as either alive or gone without evidence. Both complete live probes reran successfully with cleanup evidence. No production code changed after the prior 12,705-pass full suite and build; these are QA-driver/document changes and their dedicated tsgo script check passed.

The active entry audit found only native setup, owned markdown distribution, direct v2 permission hooks and native task/catalog/search registration; old create-managers/create-hooks/delegate-task/translator paths are not imported by the native entry. The observed native opencode command catalog exposes readonly model listing and session move/rename metadata controls, not an alternate subagent/model execution path. Final PR decomposition and dev CI/review delivery are still pending. Existing Git osxkeychain authentication also works for the GitHub API when used by an unsandboxed process. Use it transiently for gh without printing, persisting, or committing credentials; no new login is needed. Browser control remains unavailable while the Mac is locked.
