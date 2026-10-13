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
