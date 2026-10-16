# Native secondary directory permission repair, 2026-10-13

F16 conflated the native `external_directory` resource gate with tool actions. Native FileAccess asserts that gate before a separate read/edit permission. Coordinator policy consequently denied recovering its own truncated output even when native configuration authorized that exact output directory.

The permission evaluate hook now leaves `external_directory` at its existing native policy effect. Tool context filtering and execute.before retain their existing role restrictions. No directory is automatically allowed by momo; users/configuration still authorize outside readonly access through OpenCode. Coordinators, advisors and catalog researchers use the same secondary gate treatment. Unknown action protection remains in place.

## Reproduction and proof

```bash
MOMO_NATIVE_OPENCODE_BIN=/absolute/path/to/installed/opencode \
  bun script/qa/momo-native-permission-repair.ts
bun test packages/omo-opencode/src/native-runtime/permission-policy.test.ts \
  packages/omo-opencode/src/native-runtime/role-policy.test.ts
bun x --no-install tsgo --noEmit -p script/qa/tsconfig.native.json
```

The Linux driver uses a disposable project, test home, XDG roots, a local controlled provider and the real native service. It preserves the filtered context catalog, then deliberately restores forbidden tools in the QA fixture to independently prove the execute.before boundary. It records no real provider credentials. Raw synthetic contexts stay in ignored `.omo/evidence/20261013-permission-repair/`; the compact tracked receipt is [the QA JSON](qa/native-permission-repair-20261013.json).

- Prior behavior: six failing-first resource-policy regressions, and actual 2.0.27 read/grep both rejected `external_directory` for a genuine 3000-line native output artifact under an exact native allow rule.
- Fixed behavior: read line 3000 and grep both recover the final sentinel; native output rules remain allow through the hook. Arbitrary outside reads remain ask; rejection aborts read, and a separate native once grant allows read.
- Mutation boundary: native shell, edit and a neutral unknown custom tool all fail execute.before even with QA context restoration; no mutation marker is created and the approved fixture file remains unchanged. Unit checks also retain unknown MCP action denial.
- Cleanup: all service database handles confined to the disposable root, owned process group gone, disposable root removed. Real `session`, `session_v2` and `session_message` counts match before and after. Large contexts and temporary paths are excluded from this tracked receipt.

Focused tests passed 24/24. The affected adapter and native QA drivers pass tsgo. Full-workspace gates are recorded separately by the coordinating task before integration.


## Fresh recovery verification, 2026-10-16

After host reboot removed the earlier temporary logs, this slice was rerun on integration HEAD `5715d9789` (including native task API PR #39). The fresh [source-bound receipt](qa/native-permission-repair-20261016.json) records actual OpenCode 2.0.28 and policy SHA-256 `4998411fd46da852c6219a93156efe4e8f50b6d62011ffc82b8de4b24315568a`; the test SHA-256 is `9eb0ff39543c2f5d4871e5fbb2033d7403c504c816e43bc0327836277995f329`.

RED temporarily loaded the old `origin/dev` policy source. Both real truncated-output artifact recovery calls, read and grep, failed with `permission.rejected: external_directory`; the permission hook changed native allow to deny. The baseline driver exited 1 when its later outside read received no native ask. Its truncation tool states independently establish the intended reproduction. The approved policy source was restored and its exact hash checked before GREEN.

GREEN loaded the fixed production permission and role policy sources in the isolated fixture. Native allow remained allow for the output artifact; read and grep recovered the sentinel. Native ask remained ask for arbitrary outside reads: reject aborted the read, and a separate once grant completed it. Shell, edit and unknown custom execution remained denied, with no marker or approved-file mutation. The fixture deliberately restores filtered tools to independently exercise execute.before. This is source-loaded policy acceptance, not a full built-plugin flow claim.

Both native runs proved disposable database handle confinement, unchanged real DB counts, process-group exit and disposable-root removal. Raw logs now persist under `.omo/evidence/20261016-permission-repair/` and are copied to the original checkout. The driver saves to that durable evidence directory and returns a nonzero exit on failed probes.

Fresh gates on driver commit `4ad91d099`: focused 24 passed / 183 assertions; full workspace typecheck and build passed; full Bun suite 12,635 passed / 20 skipped / 0 failed, 36,434 assertions across 1,555 files (257.64 seconds). Gates ran sequentially at nice 19, CPU affinity 0,1 and GOMAXPROCS=2, with inherited Google/Gemini keys removed and a task-owned XDG data directory. The receipt includes command exits, source and bundle hashes, and log hashes. No production source changed during recovery.
