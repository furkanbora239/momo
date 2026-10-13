# Public native task API acceptance

The focused probe drives the built plugin through real OpenCode 2.0.27 Code Mode using disposable XDG directories, OPENCODE_TEST_HOME and local model/Jev fixtures. It deliberately discards the create return, recovers the task ID through list, pages a 424-candidate manager-unavailable menu, selects a worker, waits, reconstructs the actual 10023-character result, cancels another task and lists a consultation. Assertions run inside Code Mode; the recorded proof is the actual tool reply, not the model's prose. Raw RPC still retains the historical candidate array, and selection does not replay Jev.

The local Jev endpoint returns 503 for the task to expose the existing full candidate recovery path. This is API acceptance, not evidence for the separate large-catalog Jev routing repair. The local model supplies predetermined calls, so this does not prove an unscripted reasoning model discovers the API correctly.

All ASCII fixture status/select/wait/cancel replies are below 8 KiB. Unicode preview bounds, question field keys and role/parent/root authorization are covered by focused behavioral tests. Result offsets and lengths use JavaScript UTF-16 string indices; reconstruct the full text by following nextOffset. Previews are bounded by UTF-8 bytes. rolePermissions describes the role policy, with normal native resource authorization still applying. Execution verification remains unknown even when the native execution state is succeeded.

Run from the worktree:

```sh
MOMO_NATIVE_OPENCODE_BIN=/home/furkanbora/.opencode/bin/opencode MOMO_NATIVE_PLUGIN_ENTRY="$PWD/dist/index.js" bun run script/qa/momo-native-api-acceptance.ts
```

summary.json contains the actual version, bundle SHA256, Code Mode proof and cleanup receipt. The disposable process group exited and its sandbox was removed. Readonly counts for the real session, session_v2 and session_message tables were unchanged. Local focused, typecheck, build and full-suite logs are retained alongside the summary.

The first full suite had 12611 passes, 20 skips and two unchanged legacy failures: a translator readiness timeout and a synthetic-clock sync-poll timeout. The translator's test removes only GOOGLE_API_KEY, but production readiness also checks other Google variables and the real XDG auth store. Focused recheck without auth isolation repeated the translator timeout; the same two files passed all 30 tests with the isolated command below. No legacy translator/poller files were changed.

```sh
env -u GOOGLE_API_KEY -u GEMINI_API_KEY -u GOOGLE_GENERATIVE_AI_API_KEY XDG_DATA_HOME=/tmp/momo-api-test-data bun test packages/omo-opencode/src/features/local-translator/hook.test.ts packages/omo-opencode/src/tools/delegate-task/sync-poll-timeout.test.ts
env -u GOOGLE_API_KEY -u GEMINI_API_KEY -u GOOGLE_GENERATIVE_AI_API_KEY XDG_DATA_HOME=/tmp/momo-api-test-data bun test
```

The fresh isolated full suite passed: 12613 pass, 20 skip, 0 fail across 1553 files (151.81 seconds). Focused API tests passed 6/6; monorepo tsgo typecheck and full build passed. The unchanged legacy focused recheck passed 30/30 under auth isolation. The API driver's final live run passed after all production changes, with raw full-record size 352120 bytes versus 641-byte status, 807-byte select, 2938-byte wait and 650-byte cancel replies. Fixture output is ASCII, so the measured string lengths equal UTF-8 bytes; Unicode bounding uses Buffer.byteLength in the focused test.
