# Native v2 implementation checkpoint, 2026-10-12

This is an implementation checkpoint, not release acceptance. Work is saved on
`codex/momo-v2-baseline`, based on the existing migration branch. The original
checkout remains untouched. No PR has been created or merged into `dev`.

## Saved milestones

- OpenCode client/plugin/schema pinned to 2.0.24; mutable permission output fix.
- Durable native task records, scheduling, cancellation, question delivery,
  restart reconciliation, parent continuation, and session usage accounting.
- Jev routing, full eligible catalog inputs, caller selection tickets, immutable
  decision records, and exact dispatch/outcome linkage.
- Native provider/model/integration catalog, isolated stores, sourced research,
  internal catalog-researcher tasks, and advisor pool configuration.
- Owned markdown roles, momo_task/momo_consult, native session runtime and CLI,
  readonly TUI catalog RPC, and LSP/ast-grep fallback registration.
- Codebase Memory v0.11.0 candidate remains disabled by default because fixture
  QA did not prove automatic freshness.

## Verification observed

The integrated worktree passed 99 focused tests with 333 assertions and the full
monorepo typecheck. The full suite completed under escalated execution in
171.71 seconds: 12,643 passed, 6 skipped, and 46 failed. The earlier sandbox
run stalled in two-process memory tests and its confirmed task-owned process
was stopped. The native bundle no longer needs Bun's require helper. The build patcher now
accepts helper-free bundles, still rejects unresolved require calls, and passed
four focused tests and script typecheck. The complete build passed after this
fix and schema regeneration. The full suite has not yet been rerun after it.
Isolated OpenCode 2.0.24 fake-provider probes exercised real
Jev HTTP requests, worker dispatch, result delivery, native forms, and shell
denial. User database counts remained unchanged. These probes are narrower than
the complete release acceptance matrix.

Local evidence remains in `.omo/evidence/`, which is ignored by Git:

- `20261012-root-checkpoint/` contains full suite and build logs.
- `20261012-v2-native/integrated-plugin/` in the integration worktree.
- `20261012-root-native-runtime/` in the native-engine worktree.
- `20261011-native-acceptance/` in the native-engine worktree.
- `20261011-native-routing/` and TUI artifacts in the routing worktree.

## Outstanding acceptance and fixes

- The broader acceptance driver is not green. Its latest run fails the manual
  selection fixture. Earlier cases exercised parallel tasks, department work,
  consultation roles, usage, and export, but the entire matrix still needs an
  independently verified successful run.
- Coordinator Code Mode catalog still advertises momo_catalog_enrich despite
  static and execution restrictions. Resolve visibility and prove the actual
  forbidden invocation cannot mutate the knowledge store.
- CLI completion can observe a prior root turn before root result aggregation;
  review the pending inbox and subsequent root execution before returning.
- Background catalog research must not block user-job completion when its own
  manager selection is pending. Keep its unresolved choice visible.
- Native CLI still loads the old configuration view. Switch it to the native
  config loader already used by the plugin and advisor controls.
- Export must include the existing legacy `~/.omo/decision-ledger.jsonl` through
  an explicit readonly path, without using legacy claims as verified outcomes.
- Complete live question escalation, restart, busy-parent delivery, active-tool
  protection, advisor readonly search, fallback tool permissions, and TUI gates.
- Include the pinned external graph runtime's license notice when provisioning.
- Full suite/build, independent PRs to dev, CI, and review gates remain required.

All three Luna workers hit their usage limit during this checkpoint. Resume them
with their existing assignments when capacity is available; do not discard the
other two worktrees or ignored evidence.
