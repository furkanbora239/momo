# Native v2 delivery / question audit, 2026-10-13

Scope: read-only source + actual Anchor root session `ses_ecb63fb28ffehQ3JV7hTqBX4Nh`, SQLite opened `mode=ro`, tasks file `/home/furkanbora/.omo/native/projects/e07f80037f98633435544300/tasks.json`. No harness launched, no real session changed. Times below Europe/Istanbul.

## D1. Confirmed: terminal results accepted into inbox are reported as delivered before consumption

`packages/omo-opencode/src/native-runtime/session-runtime.ts:143-150` calls native `session.synthetic` with stable ID, `delivery: "queue"`, `resume: true` for root parents. `packages/omo-opencode/src/native-task/task-controls.ts:162-166` records `delivery.status = delivered` immediately after this SDK request succeeds. It does not check `session.inbox.delivered` or whether native context received the message.

At inspection the root had 8 synthetic rows still in `session_inbox`, all delivery=queue:

| Inbox ID | Task / kind | enqueued_seq |
| --- | --- | --- |
| msg_d057d6d5be38faef7c217badd4 | ntask_db74f6bf-4886-4cb6-941a-81d65a60e8fa result | 326 |
| msg_c761506d0834fb077f57371268 | ntask_9369eb3f-20fd-4fcd-a0d0-1213a3802542 cancellation | 424 |
| msg_4d7a1d8c5a271d6dfa58766cf8 | ntask_1f0c7229-a4ca-45ab-be88-065935d9cf80 question frm_134ba2d510019i1ejDGwIqQIwG | 469 |
| msg_a589c3ea7f3841807fbde04d8d | ntask_1f0c7229-a4ca-45ab-be88-065935d9cf80 result | 510 |
| msg_7b59927e22ff99d20deb065331 | ntask_548a0e5d-f04c-47a3-9244-6cd868879f35 result | 538 |
| msg_75b746350410d546a2fd610153 | ntask_e89c6274-e96c-4160-b0f0-86973393e423 result | 557 |
| msg_8c9edc6cfa0c183eaedd380e92 | ntask_931f732b-3ca9-46d5-95fa-5b5d2336ea3a cancellation | 634 |
| msg_3d1b504b3827fcfc494b8c8344 | ntask_f777e530-226f-4a34-9b23-d4e70924ccd9 report-writing result | 665 |

Each matching task result already has delivered status / attempts=1. Root `session_message` contained only two materialized synthetic results: `msg_694c55fdc56261a56b41d2a988` (catalog failure ntask_a7b8e595...) and `msg_bab8067ba949c5b447b20cd8fc` (catalog failure ntask_4b48d49d...). The user's earlier pasted first item was already consumed by inspection; one newer report result replaced it in pending rows. The session continued during the overall incident, so treat counts as a snapshot.

Installed OpenCode executable `/home/furkanbora/.opencode/bin/opencode` embeds readable minified JS. Local wrapper `/home/furkanbora/.local/bin/opencode` invokes it. Extracted relevant excerpts (no execution): `/tmp/momo-installed-opencode-queue-excerpts.txt`.

Embedded native `SessionInbox.projectDelivered` at executable byte ~140043000 deletes the inbox row. `SessionInbox.nextPromotable` ~140044900 chooses steer first; queue only when selection mode is input. `SessionRunner.drain` ~140873000 selects steer between ongoing steps, input for first/new execution; explicit queued input is excluded under a steer-only promotion. `Session.synthetic` ~140224568 admits to inbox and optionally wakes execution. TUI pending/input state references inbox and positions pending synthetic descriptions in its pending message area. Thus fixed lines match real pending inputs, not arbitrary momo toast strings.

Unresolved: exact runtime reason pending queue did not flush cannot be proven from DB alone. Busy-parent queue mode and final root interruption are supported contributors, but not enough to attribute a specific native runner bug. Root terminal idle was interrupted at 13:22:47.649. Native execution controller clears pendingWake during interrupt (embedded JS ~140084000). Need isolated reproduction of queue while continuously busy, new steer prompts, and final interruption; existing QA tested POST fault retries, not this exact real workload.

## D2. Confirmed stale question notification remains after answer and completion

`msg_4d7a1d8c5a271d6dfa58766cf8` still says child waiting for decision though the task has an answer and is succeeded. `session-runtime.ts:173,194` closes forwarded forms when no longer pending but does not cancel/remove the queued synthetic question notification. This is separate from clearing the form. It creates stale UI and stale instructions if eventually consumed. Stable IDs prevent duplicates but do not retract outdated content.

## D3. Report S7 timeout/early-completion explanation is contradicted by observed native answer

Task `ntask_1f0c7229-a4ca-45ab-be88-065935d9cf80`, child `ses_653e1d4b7c8199bbf8e90e5945`, question `frm_134ba2d510019i1ejDGwIqQIwG`:

| Observed event | Time |
| --- | --- |
| question tool created | 13:06:16.743 |
| question tool ran | 13:06:18.948 |
| root notification enqueued | 13:06:19.062 |
| child question tool completed with selected answer | 13:07:10.145 |
| question-containing assistant completed | 13:07:10.210 |
| first child execution idle success | 13:07:18.897 |
| root late momo_task answer attempted | 13:07:26.338 |
| final child idle success | 13:07:57.462 |

Child assistant message `msg_134ba13ed001q7V8NPSA65ApBS` / question tool `toolu_01L9mPaJX9iHNzxBW3P8E3R3` has completed output: user answered `Çıktı dosyasına izin ver`, metadata answers containing that same option. Durable task answer is `{q0: "Çıktı dosyasına izin ver"}`. Answer arrived about 51 seconds after question, before 120s escalation. Root tool message `msg_134bb3478001EJoNNU3eX37AT5` seq503 attempted a different instruction answer and returned `Task is not waiting for that question` because it was already answered/continued. `events.ts:77-84` clears deadline and marks running on matching question answer; `events.ts:35-38` waits for open children on success.

Do not report this case as question timeout causing success. The child did continue, retried reading truncated output, hit external_directory denial again, and then reported it could not proceed.

Provenance limit: transcript labels this a user answer, but DB does not retain form event history (`event` table empty; no current form in session_pending). Cannot distinguish original child form selected from native root UI vs forwarded form reply vs another native client. No earlier root momo_task answer matching this question was found. Installed TUI code includes descendant forms on root display, so a direct human child-form answer is plausible, not proven. This can conflict with parent-mediated routing expectations and requires targeted QA.

## D4. Confirmed execution success != requested work achieved

Executor `ntask_e89c6274-e96c-4160-b0f0-86973393e423` is succeeded with result explicitly saying it cannot complete, has no shell/edit tools, and did not change files. Executor ntask_1f0c... also says requested work unimplemented and tests not run. `events.ts:35-42` uses native execution success directly, without business/task acceptance evaluation. This is a contract/visibility gap, not necessarily a scheduler bug: terminal success presently means generation ended successfully. Parent/user need unambiguous outcome vs acceptance distinction.

## D5. Observed redundant parent generations during child cancellation

Same executor session received synthetic cancellation A `msg_fcd39006bf000eac4d09f8967d` seq102, generated a status report through seq124; aggregate children wake `msg_071feb72cb62c69d9efa71a8ce` seq131, generated another report through seq141; synthetic cancellation C `msg_ad46b80506c12308f9e9eb080b` seq148, generated a third report at seq149. All three were the same cancellation state, no work completed.

Potential amplification: results are queued individually and department gets aggregate prompt via `session-runtime.ts:197-200`. Native drains prior queued results plus aggregate input in an order that creates repeated generations. Need isolated count/batching test before calling it a production defect. This is concrete token waste observed and absent from field report.

## Follow-up investigation matrix (no fixes in this audit)

1. Confirm acceptance/admission/consumption as separate delivery identities; inspect inbox consumption events and terminal result retry policy.
2. Reproduce root queue during continuous generation, multiple steer prompts, interruption, resume; capture pending rows and actual model context.
3. Close obsolete question notifications as well as forms; prove no stale instruction after child answer/cancel/complete.
4. Verify native descendant form display and root forwarded form do not offer conflicting answer ownership; preserve actual reply source in evidence.
5. Bound department wake count when several children complete/cancel together.
6. Distinguish execution completion from acceptance/blocked/refused work in compact task responses and ledger.

## Evidence identities

Installed executable SHA256 `e26aa101cfdc40f0e680baa609ff18f131bbc6b91c60fdc11b2b2e2cba7281a4`.
Small embedded-source excerpt file SHA256 `46a8c49c22e4f5d8dc28872bbda71950de977ae7a55cb25197dbbeac1b5b9217`, size 12035 bytes. Each excerpt records exact byte offset from this executable. These support contract statements; they do not expose actual server execution control state or prove why wake failed to consume each root item.

## D6. Confirmed truncated-output retrieval deadlock: secondary external_directory permission denied for coordinators

Exact output file: `/home/furkanbora/.local/share/opencode/tool-output/tool_134ba0718001JNxaYzoH7ZhFz7`. This was produced by the executor's Code Mode execute call creating two tasks with `Promise.allSettled`, assistant message `msg_134b9d11e001gOLUhm7oPhXbbA` seq35. Full task objects made output truncate; executor lost child IDs and tried reading the automatic artifact.

| Action | Child message / tool | Result |
| --- | --- | --- |
| Initial `read` at 13:06:10.939 completion | msg_134ba076b001OnQ12moct6ZMAW / toolu_019NKc4X6HEaw4jvYcQuvNDK | permission.rejected, Permission denied: external_directory |
| Question answer at 13:07:10.145 | msg_134ba13ed001q7V8NPSA65ApBS / toolu_01L9mPaJX9iHNzxBW3P8E3R3 | selected Çıktı dosyasına izin ver |
| Retried same `read` at 13:07:11.475 completion | msg_134baf58c001IdiOXd44wqh6Qz / toolu_01S2aQPFhK7RTMZTbw3MJdCN | same permission.rejected / external_directory |
| `grep` pattern taskID, output directory, limit5 at 13:07:13.040 completion | msg_134bafaa0001AhkWH8UJ7XzdNX / toolu_01TCbC32GrKqZprFBv3btrBK | same permission.rejected / external_directory |

Source mechanism: `role-policy.ts:39-40` allows read and grep as tools. `role-policy.ts:91-100` returns deny for coordinator permission action `external_directory`, because it is neither a recognized readonly tool name nor question/skill. `permission-policy.ts:5-11` applies nativeActionEffect to *permission evaluate* events as well as tool enforcement. The policy conflates tool-action names with secondary resource permission names.

Installed OpenCode `FileAccess.authorizeRead` first runs `FileAccess.authorizeExternal` for paths outside workspace/project; that uses `r.assert({action:"external_directory",...})`, then read permission. This is embedded source at byte 140436xxx of executable SHA256 recorded above, extracted into `/tmp/momo-installed-opencode-file-access-excerpt.txt`. The denied action is a native secondary directory permission, not the read tool itself. The current momo coordinator evaluate hook deterministically denies it. This supplies a concrete source explanation rather than blaming native default external access policy alone; actual live hook trace is not retained, so individual hook invocation cannot separately be replayed from records.

The question choice `Çıktı dosyasına izin ver` was an ordinary question answer. It is not a native permission reply and does not install an access rule. Even a normal native grant cannot override the plugin hook's forced deny while this action classification remains. Actual question completion did not help, matching the two subsequent denied tools.

Impact: token-heavy raw task response triggers truncation; an authorized readonly coordinator cannot recover its own tool output; no task list exists to recover IDs; child tasks remain unselected and work stalls. This issue was mentioned symptomatically in field report but underlying secondary-action policy collision was not identified. Targeted isolated QA should cover coordinator retrieval of its own native tool-output artifact, external readonly file access under explicit authorization, and continued denial of mutation/custom tools.
