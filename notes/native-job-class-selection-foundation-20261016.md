# Job class first routing protocol foundation

MODIFIED for momo. `native-routing/job-class-selection.ts` is an unwired pure adapter,
not a completed routing feature. No runtime factory, catalog refresh, scheduler,
provider or accounting implementation calls it yet. No commits or heavy gates were
performed for this slice.

`selectJobClassModel(client, request, options)` asks three independent questions in
order: job class, native role/lane, then model. The first request sends only the task
brief and every configured class descriptor, with no model rows or model counts. The role request
sends only that brief, selected class, allowed role permission descriptions and class
counts per role. Neither request spreads the native request, candidates, instructions,
knowledge, outcomes, session identities or model facts. A task brief can itself contain
user-authored model names; this adapter does not rewrite that brief.

The model request contains only candidates in both the selected class and role, after
intersecting provided live eligibility, native caller role policy, allowed roles, required role and availability.
All class members remain represented: more than 255 candidates use the existing
hierarchical groups with complete candidate facts. There is no worker default. Native
role permission enforcement is unchanged. Existing staged selection exports its role
descriptors and choice validator for reuse; those implementations were not duplicated.

The injected `readClassMembership(model)` must come from the profile store's validated
`read(currentDefinitions, currentSourceInput)` result. It is read once per distinct
model per decision. Stale or missing profiles return undefined. This adapter never
reclassifies models and never promotes recommendations into verified knowledge facts.
Multiple suitable classes are supported. Missing/unknown or weak suitability results
are excluded; when none qualify, `classification_pending` explicitly signals pending
classification. Confidently unsuitable or live-ineligible catalogs return
`class_unavailable` before any Jev call.

Answers carry `jobClass`, role/model, recommendation provenance, minimum confidence
across every answered selection stage and conditional model probabilities. Low stage
confidence stops before later requests. Invalid choices, malformed distributions and
incompatible role/lane responses fail without fallback. The shared validator accepts
0.99 rounded probability mass. Root must consolidate this with the accounting branch's
shared probability helper and native router validation during composition.

`JobClassSelectionError` retains completed stage results and failing request evidence,
plus a transport error cause. It returns no synthesized usage/cost totals. The injected
backend must audit every actual HTTP attempt and durably record cost before semantic
decoding, including retries and partially successful selection flows. That is the
accounting owner's responsibility. Compose pre-send unavailable/pending outcomes with
the accounting branch's `NativeJevAdmissionError` contract before wiring factories;
this slice does not invent that unavailable dependency or treat client-default zero
cost as audited spend.

Focused checks run from `/tmp` using the absolute test path, avoiding workspace preload
and LSP builds. The tiny test file covers zero-identity class/role payloads, combined
class/role filtering, multiclass and unknown profiles, one-model selection, 256-model
coverage, no worker fallback, cache lookup reuse, low confidence, 0.99 mass, malformed
answers and preserved earlier evidence on later failure. Exact results and hashes
are in `.omo/evidence/20261016-job-classification/selection-checks.json` with raw output
in `selection-focused.log`. Workspace typecheck, full tests, build, source-bound native
QA and PR delivery remain root-owned pending gates. No real harness acceptance is claimed.
