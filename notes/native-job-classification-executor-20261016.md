# Job classification executor core

This is an unwired maintenance controller. It does not authorize paid traffic, instantiate a Jev client, spawn native research tasks, consume worker CPU sessions, or open root forms. Existing profile store, identity, codec and role/job selection modules are unchanged by this slice. Actual runtime/bootstrap/router configuration and paid shared-router accounting integration remain separate work.

## Contract

`createJobClassificationExecutor` takes a durable state path, existing profile store, current source inputs/definitions, eligibility callback and an audited executor. Optional admission and revision callbacks support provider/budget pauses. The audited executor receives `{batch, intentID}` and returns `{result, receipt}`. Its owner MUST check the shared manager/provider/budget guards and persist authoritative HTTP intent and every attempt's usage to the durable accounting ledger before returning or throwing, including malformed paid responses. The returned receipt references that ledger. This core persists a scheduling intent and failure state, but never creates or estimates a billing receipt from semantic output. `JobClassificationNoSendError` is reserved for the audited owner to report a verified refusal before any HTTP request; an ambiguous transport failure is never treated as no-send.

`pump()` performs at most one bounded batch. A caller may await one pump during startup before registering tools, then call `start()` for the remaining background queue. `stop()` cancels future ticks and awaits any active batch. Overlapping pump calls share one promise; no filesystem lock is held during asynchronous admission or HTTP. One controller owns each state file. Multiple concurrent controller instances are unsupported; a replacement after a process crash recovers inflight intents as failed/ambiguous without automatic replay.

The controller obtains only `profileStore.pending` inputs and derives its model count as `min(4, floor(32 / classCount))`. Each model must independently fit the codec; aggregate evidence is packed below the codec's 24KB limit. Oversized items fail durably without preventing smaller later items from running. A single malformed paid answer fails that batch and is not retried on subsequent ticks or restart. Unknown profiles are cached normally. Explicit `retry()` requeues failed or paused items. Eligibility revision changes automatically resume paused no-send items; they do not replay failed potentially paid work. New fingerprints replace failed or paused entries and are eligible for fresh classification.

Facts and eligibility are checked after batch preparation and again after the HTTP result, before saving profiles. Changed inputs/definitions cannot receive a profile for their old fingerprint. Partial batches save only still-current eligible profiles while preserving the single audited usage receipt. If all profiles are stale, usage remains in the injected authoritative ledger and the receipt ID remains in executor state; no fabricated profile is written to retain it. Queue entries, failures/reasons, last receipt and cumulative batch/profile/stale counts are atomically persisted.

This path deliberately does not consult the ordinary router's awaiting-selection busy gate: classification can be a prerequisite for that selection, so using its busy check here would deadlock progress. Shared spend admission belongs to the injected audited transport owner, not that ordinary selection gate.

## Verification

Persistent evidence: `.omo/evidence/20261016-job-classification-executor/`.

- RED: missing executor import, as expected. The initial root-config focused command also triggered the repository test preload's implicit vendored lsp-daemon npm/bootstrap build. The raw log retains that side effect; it is not claimed as a build gate.
- Subsequent tests use the persistent `no-preload.bunfig.toml`, which explicitly sets `preload = []`; no further install/build bootstrap occurs.
- Focused GREEN: 18 tests, 58 assertions; exact output is in `green.log`. Covers restart cache, new and changed models, concurrent pumps, malformed paid responses, unknown profiles, facts/definitions/eligibility changing during HTTP, bounded question/byte packing, durable provider pauses, explicit retry/revision recovery, ambiguous crash/transport handling corrupt-state refusal and background stop/drain behavior.
- No real API, native harness, full suite, production build or workspace typecheck was run as an executor acceptance gate. Root owns integration and broader checks after accounting composition.

## Follow-up review, 2026-10-17

Five additional behavioral tests first failed against the initial executor, with the failures preserved in `review-red.log`. The repaired executor validates an audited receipt before persisting its ID, retains unexpected refresh/storage/paid failures in `status().lastError`, reports whether its background scheduler is running, and preserves the revision observed before asynchronous eligibility/admission work. A revision change during a verified no-send refusal can therefore resume the paused batch on the next pump. Potentially paid failures still require an explicit retry or new source fingerprint.

`lastError` is a retained diagnostic, not a current health flag. A caller can distinguish active scheduling through `backgroundRunning`, active work through `running`, and queued/failed/paused counts. If saving the diagnostic also fails, the combined error remains visible in memory; durable recovery cannot be promised with inaccessible storage. Unexpected background failures stop scheduling and remain visible rather than retrying silently.

Runtime integration must supply `currentRevision` from relevant provider, pool, manager and budget admission controls if it expects automatic recovery. Without that optional callback, paused entries require explicit `retry()`. The callback must change when those controls change; wall-clock ticks must not constitute revisions. `executeAudited` remains the sole owner of the shared paid-call boundary and its authoritative ledger. This controller does not verify an injected owner's durable ledger or grant permission to bypass manager, provider or shared budget checks.

Independent focused recheck: **23 tests passed, 72 assertions, 0 failures**, including the original 18 tests and five review regressions. The source-bound combined output is `review-recheck-green.log`; review changes are still unwired and do not constitute native runtime acceptance. No build, full suite, workspace typecheck, native process or external API was run for this follow-up.
