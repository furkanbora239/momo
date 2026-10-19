# Persistent model job classification foundation

MODIFIED for momo. This is a pure data/protocol foundation; native catalog refresh,
background maintenance and task routing do not call it yet.

`native-catalog` now exports class definitions, source-backed classification input,
recommendation profiles, a bounded Jev request/response codec and an atomic profile
store. Job IDs are operator-defined strings such as coding/research/planning. They
have no relation to native worker/planner/reviewer execution permissions.

Profiles retain source evidence and the complete versioned class definitions.
Cache identity covers model identity, canonical source facts, definitions (including
descriptions), definition version and classifier version. Evidence and class ordering
do not invalidate the cache; actual fact changes do. Unknown results are persisted
and reused too, avoiding endless classification attempts for unchanged sparse data.
Recommendations never become native verified knowledge facts.

The codec creates one three-choice suitability question per model/job pair, allowing
multiple suitable job memberships. One request contains at most four models, 32
questions and 24,000 state bytes. Oversized evidence is rejected rather than silently
truncated. Missing/malformed answers reject the complete batch. Probability distributions must
use supported keys, include the selected option, contain finite probabilities and
sum to one within a 0.01 rounding tolerance (including 0.99). The local validator
should consolidate with decision-core after its accounting helper integration. Inputs with no
nonempty evidence facts are forced unknown. For source facts that are present but
insufficient, the classifier can explicitly return unknown. The decoder requires an explicit audited HTTP usage receipt and ignores the client
result's defaulted usage/cost fields. `captureJobClassificationUsage` consumes raw
usage from every actual HTTP attempt, including retries. Missing or malformed raw
input usage produces unknown cost; authoritative raw zero remains zero. Input usage
determines cost at the existing Jev input rate (USD 0.042 per million tokens);
observed output usage adds no charge. No request fee is introduced.

Integration handoff:

1. A single maintenance owner reads the live SDK catalog and sourced enrichment.
   Build source-backed inputs directly from available metadata, excluding volatile
   availability/fetch timestamps and previous recommendations. SDK-only entries
   may be pending at cold start; selected-only deep research is not a prerequisite.
2. Call `pending(definitions, inputs, limit)` on catalog creation/enrichment. Apply
   live provider/pool/policy/budget guards and idle scheduling before any API call.
   Split pending entries using the codec bounds, call Jev's existing `ask` surface,
   capture an audited usage receipt and durably record it in the executor's separate
   cost/attempt ledger BEFORE invoking the answer decoder. This ordering is mandatory:
   malformed responses or classification persistence failures must retain their
   spend, and unknown input usage must retain a budget-blocking unknown charge.
   Then decode with that receipt and save each complete result. Serialize maintenance; this store does
   not provide a cross-process scheduler or lease. Failed requests do not save a
   partial classification. Retry/breaker/attempt ledger integration belongs to the maintenance owner, separate
   from successful profile usage snapshots. This foundation does not write that
   durable ledger and cannot replace the accounting branch's authoritative HTTP
   audit/unknown-cost logic.
3. Task-time routing must first send task plus every configured compact class descriptor
   with zero model rows or model counts. It must then choose a native role independently and send
   only live eligible models from the chosen suitable class. Unknown profiles do
   not imply worker/coding membership. Existing live eligibility remains authoritative.
4. Preserve caller-selection behavior and perform built-plugin fake-Jev OpenCode
   QA for scheduling/restart and both request stages before claiming the feature.

Focused verification: eleven tests, 43 assertions, all passing. The first RED state was missing codec/store modules before implementation. Follow-up
RED reproduced acceptance of an empty probability distribution and a false zero-cost
classification from client default usage. Both are now covered by passing checks. Evidence is under
`.omo/evidence/20261016-job-classification/foundation-checks.json`. No production
runtime integration or real harness proof is claimed. Root owns remaining typecheck,
full suite/build, actual isolated OpenCode QA and PR delivery.
