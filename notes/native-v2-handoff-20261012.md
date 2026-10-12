# momo native v2: resume here (2026-10-12)

This is the current handoff and execution roadmap. It supersedes the verification and outstanding-work sections of `native-v2-checkpoint-20261012.md`. This migration is not release accepted or merged into dev.

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
