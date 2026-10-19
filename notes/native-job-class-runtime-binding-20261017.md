# Native job-class runtime binding, 2026-10-17

MODIFIED: momo binds cached job classes to the active OpenCode runtime.

`registerNativeTools` constructs one catalog job-routing owner after the catalog refresh. Routing and catalog classification use its shared durable Jev accountant. Model classification uses the configured job types (six defaults), while task-time selection separately chooses a class, role and eligible model. Runtime status exposes queue diagnostics under the catalog snapshot; validated immutable profile files are reused across projects from the native home cache.

Every classifier HTTP attempt admits the actual batch against fresh provider registration, native activation, integration connection, local provider toggles, health and hard pool. This uses the batch directly rather than a fabricated task-routing request. The manager provider is admitted independently from the child model pool. Control/snapshot revisions allow verified no-send pauses to resume when eligibility changes. Manager credential failures remain typed admission refusals. Routing retains its candidate/advisor checks on every attempt.

Only the F17 provider admission helpers and catalog adapter changes were ported. Current-base session runtime checks the assigned model before start, resume, result/root question wake, form reply and department continuation. It preserves the existing root selection exception to the child hard pool. No consumption state machine or delivery implementation was copied from another branch.

Focused verification: 31 tests, 83 assertions, zero failures across model admission, native provider admission, the current session bridge and catalog-routing assembly. The earlier sandbox run could not bind local fixture listeners; the corrected form fixture and an approved listener-capable retry passed. Source hashes and the test-tool receipt are under `.omo/evidence/20261017-job-class-binding/`. Monorepo typecheck, build, full suite and real full-plugin native QA have not been run for this new binding.

F02 head `f35b45e0ea376f7147a5f2abb6918599a2ae50bb` is now composed. The router retains selected/dispatched-only research, explicit research binding, durable recovery and pending immutable failure dispatch controls. The runtime retains one idle maintenance executor. Config preserves both research_executor and job_classes, the adapter preserves both model quarantine and fresh provider admission, and session inspection preserves native failure identity/model/completion time. The four textual conflicts were resolved as the union of those behaviors; the private accounting reservation fields were replaced with the shared accountant. After composition, 130 focused tests with 445 assertions pass across 12 files, including the root legacy billing repair. All restored untracked files match their precomposition backup hashes, and jev-usage.ts matches its stash source exactly. The persistent named stash is a12b20a5648888912df3cf78e0cae287bcfecea4.

Remaining composition before final acceptance: Merge the consumption/F17 branches carefully at the session-runtime and task-tools hunks; these hooks alone do not prove the final receipt/aggregate delivery flow. Final real-harness QA must demonstrate the active built plugin uses this binding, profiles survive restart, changed facts invalidate only affected rows, class selection receives no model rows, model selection receives only its selected class/role, and disabled providers cause zero outgoing requests.


## Final composed acceptance matrix

The following are required on the final provider/consumption/accountant composition;
existing focused checks do not satisfy these runtime gates.

| Area | Real native observation |
| --- | --- |
| Catalog input | SDK capabilities precede the first classifier request; at most four models, 32 questions and 24 KB state per batch. Source-free models remain unknown. |
| Routing | Each task asks class first using all configured definitions and no model rows/counts, then role using no model identities, then only candidates from that class and role. Roles retain native permission enforcement. |
| Cache | An unchanged restart and a second project send no classifier HTTP or imported billing; a new model sends only that model; a source capability change sends only the changed model. Price and fetch time changes preserve cache identity. |
| Provider control | A disabled provider may remain listed in the hard pool, yet contributes no classification input, routing candidate or native model execution. Manager admission is checked independently. |
| Billing | Paid malformed classifier output persists input-only usage and exhausts the shared budget; missing raw input usage remains unknown. Both block later routing and classification across restart without another HTTP or invented zero/output-only cost. |
| Isolation | Actual opened DB descriptors remain below the isolated root; real user DB counts remain unchanged during each run; owned process groups exit before temporary files are removed. |
| Source binding | Runtime source and bundle hashes are equal before/after native proof. Build, monorepo tsgo, generated schema and full-suite results name the final composed source. |

The main native probe and billing probe cover separate rows of this matrix. Unit
checks additionally cover unknown and sparse research, multiclass membership,
rounding, weak recommendations and every injected admission boundary. A green main
probe alone does not prove the paid malformed/restart case. Research facts can remain
unknown; such rows never acquire an invented coding/worker default.

Catalog classifications and runtime choices use one input-only budget ledger. Facts,
class definitions and classifier versions determine cache identity; changing source
facts or either definition version invalidates only matching profiles. Classification
is shared catalog maintenance, never a new classification for every task. None of
these receipts authorizes external provider traffic in QA.


## Cross-project cache ownership

Validated recommendations are shared at the configured native home under
`.omo/native/job-classifications/<fingerprint>.json`. Each immutable file contains a
profile, never a billing receipt. Atomic no-replace publication preserves independent
fingerprints and the first complete valid profile. Facts, model identity, definitions
and classifier versions all participate in that fingerprint, so projects with different
classes coexist without overwriting one another. Malformed shared files fail closed
with an explicit error; they never admit recommendations or silently trigger paid repair.

Maintenance state, paid-call intents and canonical spend remain in the originating
project. Reading a shared profile neither copies another project's usage snapshot nor
replays its charge. Separate processes starting simultaneously with an empty cache can
both pay for classification before the first profile is published. This cache does not
claim a distributed exactly-once paid scheduler. Existing runtime single-flight still
serializes batches within each owner.


## Provider and consumption composition, 2026-10-18

Composed verified provider head `e6c286bb1bec5dc4adbf19dbfa33254e937f2ac6`
without changing its session runtime, tests, provider admission helper or catalog
adapter. That retains F03/F07/F15 consumption, immutable delivered-message inspection,
forwarded-form lifecycle and F19 single root steering wake. Classification adds batch
admission and revision callbacks to the provider's admission owner. Task registration
retains one complete admission owner and all manager, routing, classification and
native generation guards. Identical duplicate catalog exports from the textual merge
were removed after a focused import error.

All eleven shared accountant files match the frozen standalone core byte for byte.
The composed focused matrix passes **237 tests, 898 assertions across 21 files**.
Build, typecheck, generated schema, full suite and native feature acceptance remain
pending the final accepted accountant composition. The preserved named feature stash
is `bfcc3a03e33dd0ef5eeeb94de1f775d15180a5db`.

## Final acceptance, 2026-10-19

The historical pending checkpoints above are superseded by the source-bound composed acceptance in [native-job-classification-20261017.json](qa/native-job-classification-20261017.json). Generated schema, production build, complete monorepo typecheck, native QA typecheck, the complete fresh full suite and all three isolated OpenCode 2.0.32 feature scenarios passed. No production source changed after the native proofs. The main proof covers actual worker execution, class/role/model request separation, unchanged restart, second-project profile reuse without imported billing, targeted model/fact invalidation and passive-provider exclusion. Separate paid-malformed and unknown-input proofs cover shared budget blocking across restart. Exact-head CI and bounded Cubic review remain publication gates; historical interrupted full output is retained as a non-pass.
