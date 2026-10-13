# First native-v2 live API audit (2026-10-13)

Read-only evidence: SQLite `file:/home/furkanbora/.local/share/opencode/opencode.db?mode=ro`, root `ses_ecb63fb28ffehQ3JV7hTqBX4Nh`, `session_message.seq`; persisted `/home/furkanbora/.omo/native/projects/e07f80037f98633435544300/tasks.json`. No production files, sessions, or tasks changed. Sources below are relative to `/home/furkanbora/code/ai/momo`.

## Disposition of agent report S1–S13

| Claim | Disposition | Evidence / correction |
|---|---|---|
| S1 JSON string / lost ID | Confirmed usability failure, not inconsistent JSON encoding | `task-tools.ts:45-47` consistently wraps pretty JSON in text content. Root seq 384 reads `r.id` from a string and prints `{}`; seq 404 explicitly confirms `string`. Tool description `task-tools.ts:187` gives no parse contract or compact example. Orphan is `ntask_c1fc8e20-fe7e-450e-bf85-cfedab0d3424`, still awaiting_selection, attempts 0, no session/model. It never ran or failed with privacy error. Returning a native object must be designed against the actual OpenCode tool protocol, which currently expects content, rather than blindly changing the response type. |
| S2 no recovery/list | Confirmed for agent surface | Input actions `task-tools.ts:29-37` have no list; status/wait/cancel require taskID. Readonly RPC already has list-by-root at `task-tools.ts:231,237-240`, so backend capability exists but is not exposed to the model. Lost task remains awaiting selection, not active resource execution. |
| S3 create must always select | Overgeneralized | `applyRoute` supports automatic selected route (`guards.ts:32-35`). Live root tasks often awaited selection. Selection need is deliberate on manager failure/uncertainty; reasons require routing investigation. Adding unconditional auto-fallback would violate native migration's no-silent-fallback policy. |
| S4 huge status/wait | Confirmed; quantities corrected | Raw records returned at `task-controls.ts:234-237,240-261`, prettified at `task-tools.ts:45-47`. Root candidate array is 424 = 8 roles × 53 models, not 9 roles. Event history bounded at 128 (`events.ts:4,26-27`), not thousands. Candidates dominate response. Details below. |
| S5 wait omits result / invalid JSON | Both causal claims unsupported / contradicted | wait returns full task including result. Root seq 317 explicitly discards result, treating progress string as object and returning last character `e`; seq 327/336 retrieves proper result. Root seq 511 parses already-parsed `o.question` again; object coerces to `[object Object]` and JSON.parse throws. Code JSON.stringify is valid. Timeout returns nonterminal snapshots, so wait completion must not be equated with task completion (`task-controls.ts:253-261`). |
| S6 worker can delegate | Incorrect role attribution; discoverability problem real | Selected role was executor, a department lead. `native-task/policy.ts:3-20` permits department delegation and denies worker delegation; `role-policy.ts:25,35-36,129` denies/removes worker momo_task. Executor prompt explicitly says delegate and no direct shell/edit (`assets/native-agents/momo-executor.md:7`). Root seq 438 selects executor then seq 503 orders it to do all edits personally and forbids delegation, creating impossible instructions. |
| S7 question expires then succeeds | Observed answer rejection; timeout causal claim not established | Root seq 474/483 sees waiting_question; seq 492 cancels both children; seq 503 answer rejects; seq 520 already succeeded. Question watchdog escalates at 120 seconds, it does not mark succeeded (`task-lifecycle.ts:135-141`). Cancellation/parent wake ordering needs separate timeline audit. |
| S8 privacy policy failure from orphan | Wrong attribution | Orphan c1fc8e20 has no attempts/session/model. Two different research tasks failed; not a repeated retry of orphan. Root seq 690/705 later invents repeated orphan retry and starts another report-writing worker d0cd5be0; that worker is interrupted. Policy eligibility and generic provider error attribution remain product issues. |
| S9 role/tool visibility | Confirmed lack of runtime metadata, wrong inference that model removes tools | Candidates contain model toolCall/capabilities, not role edit/shell/delegate policy (`native-routing/types.ts:36-46,86-93`). Policy is determined by role. Executor deny is deliberate. Explore actual child `ses_08f30b2b3baf7cdc5d4338ebe3` seq 5 and many later seqs shows successful shell tools; role permission consistency needs its own audit. |
| S10 candidates lack useful metadata | Partially correct | toolCall already present and true in observed rows. Missing candidate role permission summary (canEdit/canShell/canDelegate), not absent tool-call model fact. All-role candidate multiplication and duplicated facts in knowledge.model cause noise. |
| S11 progress unusable | Confirmed limited observability | Generic progress supplied by `v2-event-adapter.ts:20-38`; terminal record retains last progress (`events.ts:35-43,65-67`). activeTools exists (`events.ts:59-63`) but only in-flight activity, no durable completed-tool trace. Root seq 295 prints generic progress; seq 317 wrongly accesses it as object. Tool name fallback can be `tool` if input-start event name is missing (`v2-event-adapter.ts:39-40`). |
| S12 scope collision warning absent | Feature gap confirmed; actual concurrent collision unproven | scope is free text (`task-tools.ts:30`, `types.ts:113`); capacity checks provider/model/running count only (`guards.ts:65-85`). No file lease/reservation semantics. Cannot claim lost edits from this run. |
| S13 AGENTS must be repeated | Not proved as harness defect | Agent manually inserts instructions, but native orchestrator body already says inspect instructions (`assets/native-agents/momo-orchestrator.md:7`). No special task briefing field in `task-tools.ts:30`; runtime/native OpenCode instruction ingestion needs dedicated validation before adding duplicated prompt content. |

## Quantified bloat

Measured current persisted task via JavaScript `Buffer.byteLength(JSON.stringify(task,null,2))`, matching production formatter. Ordinary root task records are 460,168–487,076 UTF-8 bytes; compact serialization 289,039–315,228 bytes. The full pretty candidate array alone is 424,997 bytes; root candidate facts repeat 8 times, and each knowledge.model duplicates model facts. Child executor tasks retain 265 = 5 roles × 53 models, producing 289,966–291,118 bytes pretty.

Examples:

| Task | state / role | pretty bytes | compact bytes | candidates | event IDs |
|---|---|---:|---:|---:|---:|
| db74f6bf-4886-4cb6-941a-81d65a60e8fa | succeeded / explore | 480555 | 308707 | 424 | 128 |
| c1fc8e20-fe7e-450e-bf85-cfedab0d3424 | awaiting_selection / none | 466516 | 295420 | 424 | 0 |
| 1f0c7229-a4ca-45ab-be88-065935d9cf80 | succeeded / executor | 472990 | 300794 | 424 | 102 |
| 548a0e5d-f04c-47a3-9244-6cd868879f35 | succeeded / planner | 487076 | 315228 | 424 | 128 |
| e89c6274-e96c-4160-b0f0-86973393e423 | succeeded / executor | 469028 | 297740 | 424 | 16 |

Task IDs in table have `ntask_` prefix. Candidates are 87–92% of ordinary pretty root responses. Event ID array maximum observed is only ~4.3 KB compact, so removing it alone cannot solve bloat.

Historical actual tool output seq 35 was truncated by native tool display to 51,332 bytes; metadata points to full output `/home/furkanbora/.local/share/opencode/tool-output/tool_1349caed7001ZbDEhM6zeMqWiq` and says showing lines 1–1845 of 17112. Seq 63 selected response also truncated (51,321 bytes; 17120 full lines). Root seq 139 agent sliced at 14000 chars and explicitly reported raw string length 466952. Exact model token exposure depends on OpenCode truncation and code-mode postprocessing; do not report all raw record bytes as model tokens.

Persistent stale candidate retention root cause: `guards.ts:6-11` writes candidates/error for awaiting selection, then selected branch `guards.ts:32-35` never removes them. Consequently completed status/select/cancel keep historical route menus. This is an additional finding not distinguished in the agent report.

## Other findings missing / misinterpreted by agent

1. Snapshot is now 64 tasks = 53 catalog research + 11 user/child/probe/report tasks. Report is still 132 lines; additional d0cd5be0 report append task is interrupted. Earlier total 63 was a previous snapshot, not a code regression.
2. Report generation itself succeeded with worker f777e530; therefore '0 code edits' should be scoped to the requested product changes, not all filesystem writes.
3. Runtime `succeeded` is execution completion, not acceptance verification: executor e89c6274 succeeded while admitting no tools/no edits. An actual failed assignment and successful session turn are presently collapsed for user assessment. Follow-up acceptance/outcome audits should preserve this distinction.
4. Losing a create return can duplicate work even when task never dispatches: agent created c1fc8e20 then 9369eb3f ping, cancelled ping and created 1f0c7229. A user-facing root task list and stable request recovery/idempotency need consideration.
5. Agent's temporary remedy 'forbid all delegation' is unsafe as a global recommendation: correct for worker, self-defeating for executor. Restrict direct editing work to worker or clearly present department semantics.
6. Typed code-mode tooling needs usable output documentation. String-on-call and object-inside-JSON were mixed twice (create id loss, nested question double-parse), while giant output incentivized manual slicing and unreliable field extraction.

No fixes recommended for execution until findings are combined with delivery, questions, routing and installed-bundle audits. Primary validated API priorities: compact public task DTO; list/recovery; documented string/content contract or protocol-compatible structured output; candidate role permission summaries; expose runtime versus acceptance status; progress/tool history.
