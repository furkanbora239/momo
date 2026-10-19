# Shared native Jev accounting core, 2026-10-17

MODIFIED: momo adds a reusable paid-call accounting boundary without enabling catalog job classification.

## Scope and preservation

Base: `fd2963b3cc47e9fa0f033b42a3f79fdd3e037def` (catalog repair PR #43). The previous shared-core working tree is preserved in the named stash `shared-core-preserve-all-before-20261017-port` and `.omo/recovery/shared-core-20261017/` (tracked diffs, untracked tar and SHA-256 manifest). Only eleven routing source/test files were copied from the classification worktree. No catalog profiles, feature configuration, classifier executor, runtime binding, or task tool changes are included.

The default router now owns or accepts one shared accountant. A stable call ID and input digest are persisted before execution. The accountant serializes calls, retains provider input-only usage before semantic decoding, refuses automatic replay, and reconstructs monthly spend after restart. Canonical call receipts are counted once; linked routing snapshots cannot charge a call again. Legacy audited raw HTTP usage takes precedence over older semantic zero estimates; explicit F10 receipts retain priority. Unknown sent usage and interrupted intents pause capped calls. Verified refusal before HTTP is uncharged.

Optional catalog preparation executes before the routing accountant queue, preventing a future classifier from deadlocking while acquiring the same paid-call boundary. This core does not enable that feature.

## Verification

The accepted source composes provider/consumption commit `e6c286bb1bec5dc4adbf19dbfa33254e937f2ac6`. The merged dev commit `2ee7c0b0d2e57e1e831be0680e0177c5e69032f9` has exactly the same tree; composing that ancestry changes no accepted source.

Build, complete monorepo tsgo and focused tests passed. Focused tests: 67 passed, 0 failed, 224 assertions. Full suite: **12,739 passed, 20 skipped, 0 failed**, 37,406 assertions across 1,563 files in 260.46 seconds. All gate source hashes remained unchanged.

Actual OpenCode 2.0.32 loaded this worktree's rebuilt plugin and local mock endpoints. The native matrix proved:

- Paid malformed output: one canonical paid call and one HTTP request across restart; authoritative input billing remains charged and a later call is blocked.
- Missing source usage: one canonical call and one HTTP request across restart; capped calls remain paused instead of inventing free spend.
- Refusal before HTTP: three canonical `not_sent` calls, no usage and zero HTTP requests across restart.

Each case observed database descriptors for both actual service processes inside its disposable root, unchanged real database counts within the run, and successful service-group/sandbox cleanup. The final runner left no owned process or temporary root. No production provider request was made.

The unknown-spend native case found a reason-normalization bug: the outer router branch prefixed the preserved budget reason with a generic unavailable label. A focused regression failed before the one-line fix and passed afterward. The complete source-bound gates were repeated after that production change. Earlier version-format and missing package-local dependency-link failures remain recorded as failed attempts; none is counted as acceptance.

The sanitized source hashes, bundle/native binary hashes, exact totals and per-case receipts are in `notes/qa/native-shared-jev-accounting-20261018.json`. Raw logs remain in task-owned ignored evidence. Gate durations are monotonic; host wall-clock labels differ from GitHub HTTP Date and are not used for PR review windows.

## Boundaries

One runtime owns an accounting store. Cross-process store locking is outside this slice. A call is assigned to the UTC month of its persisted intent. Unknown spend pauses only a configured cap, preserving the existing uncapped policy. This PR activates no catalog classifier, profiles, job classes or task routing stages.
