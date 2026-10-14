# Public native task API acceptance

Final verification on 2026-10-14 drives the rebuilt plugin through real OpenCode 2.0.28 Code Mode with disposable XDG directories, OPENCODE_TEST_HOME and local model/Jev fixtures. It discards the create reply, recovers the task ID through list, pages a 424-candidate menu, selects a worker without replaying Jev, reconstructs its complete 10023-character result, cancels another task and lists a consultation. Success comes from the actual Code Mode tool result, not echoed source or model prose.

The fixture also creates an actual SDK native form with a 140-character field key and a 300-character option value, obtains the answer schema through task detail, sends the exact identifiers through momo_task answer and observes native form completion. Detail now flags UTF-8 assignment truncation by comparing the returned text, rather than comparing UTF-16 lengths. Native keys and option values stay exact; schemas or standalone options exceeding their byte budgets require the full native form. Oversized standalone options correctly propagate this requirement to the top-level detail flag.

The local Jev endpoint returns 503 for manual-selection fixtures and supports the actual staged role/model contract for the native-form task. This proves the compact API paths with deterministic fixtures; it does not prove that an unscripted reasoning model discovers the API unaided. Raw RPC retains all 424 historical candidates and the 352120-byte record. Actual public status/select/wait/cancel replies measure 641/807/2938/650 bytes. Unicode preview bounds and oversized form behavior are covered by behavioral tests. Result offsets use JavaScript UTF-16 string indices; reconstruct the complete text by following nextOffset. Execution verification remains unknown after successful execution.

Final gates passed on the frozen production tree: script and monorepo tsgo typechecks, full build, fixture self-test, and the full Bun suite (12625 pass, 20 skip, zero fail; 42953 assertions across 1554 files in 161.90 seconds). The standalone-options focused run passed 9 tests with 58 assertions. Full tests strip inherited Google credentials and use isolated XDG directories, avoiding the unchanged legacy translator auth fixture leakage.

The final bundle SHA256 and production source hashes, actual tool proof, native form reply and cleanup receipt are in [sanitized-summary.json](sanitized-summary.json). Detailed synthetic context and logs remain in final-green/. The owned native process group exited, the disposable sandbox was removed and readonly real database counts for session/session_v2/session_message stayed 249/313/17931.

Repeat from the worktree:

```sh
MOMO_NATIVE_OPENCODE_BIN=/home/furkanbora/.opencode/bin/opencode MOMO_NATIVE_PLUGIN_ENTRY="$PWD/dist/index.js" bun script/qa/momo-native-api-acceptance.ts
```

The earlier final attempt failed because its Jev fixture lacked overflow stages; it is retained in final/ as rejected evidence. An earlier full runner loaded the pre-fix module while a reviewer fix was being applied; that mixed-tree run is not a final gate. The accepted full run above kept production and tests frozen throughout.
