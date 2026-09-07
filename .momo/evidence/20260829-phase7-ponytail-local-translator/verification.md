# Phase 7 QA Evidence — Ponytail/Caveman Prompts + Local Prompt Translator

**Date:** 2026-08-29
**Branch:** `dev` (post-0ce7c31a0)
**Scope:** Phase 7A (prompt rewrite) + Phase 7B (local translator), QA per
`src/AGENTS.md` "STOP. QA IS MANDATORY" with the `opencode-qa` skill approach.

## Gates

```
bun run typecheck                                   clean
bun run build                                       all steps completed
bun test packages/omo-opencode/src/features/local-translator
                                                    13 pass  0 fail
bun test agents + config + plugin + local-translator
                                                    1088 pass  0 fail (132 files)
```

Dist bundle verification (post-rebuild): `grep -c ponytail_ladder dist/index.js`
= 2; `local-translator` = 27; `qwen2.5` = 49. `dist/features/local-translator/`
declaration tree present.

## 7A — Prompt content proof

`7a-prompt-dump.ts` calls `createSisyphusAgent("deepseek-chat", ...)` (fallback
family -> `buildMomoOrchestratorPrompt`) with fixture explore/librarian/oracle
agents. Output: `7a-prompt-content.txt` (265 lines, 12.3 KB).

Observed in the generated prompt:

- `<ponytail_ladder>` block with the 7-rung solution ladder (line 41).
- Condensed `### Explore = Contextual Grep (peer tool, not fallback)` (189).
- Condensed `### Librarian = Reference Grep (external: docs, OSS, web)` (197).
- Condensed `## Oracle = read-only expensive consultant` (204).

Per repo convention, no committed test asserts prompt prose; this dump is
evidence only. Net diff of the 7A commit (`a01431739`): -393/+216 lines across
shared sections + momo-orchestrator + default.

## 7B — Fake-Ollama end-to-end wiring proof

`7b-fake-ollama-wiring-drive.ts` drives the REAL wiring path
(`createTransformHooks` -> `createMessagesTransformHandler`, the same handler
opencode invokes) against a local fake Ollama HTTP server. Output:
`7b-fake-ollama-wiring-drive.txt`.

- Scenario 1 (enabled + reachable): Turkish text replaced by the fake
  translation; 1 `/api/chat` hit; wire body shows
  `model: qwen2.5:1.5b`, `options: {"temperature":0.1,"num_ctx":2048,"num_predict":128}`,
  translator system prompt + Turkish user content verbatim.
- Scenario 2 (`enabled: false`): hook not wired (`localTranslator` null), text
  unchanged, no calls.
- Scenario 3 (short message): ZERO network (0 chat + 0 tags hits) - skip rules
  run before any readiness call.

## QA bug log (found during this QA, all fixed)

| # | Bug | Symptom | Fix |
|---|-----|---------|-----|
| 1 | `resolveConfig` naive spread let explicit `undefined` from `create-transform-hooks` clobber defaults | Wire body had `model: undefined`, no `num_ctx`/`num_predict` -> real Ollama would 404 | Skip `undefined` values when merging defaults (hook.ts) |
| 2 | Module-level `initializationPromise` shared across all hook instances | Unreachable-host config poisoned cached `false`; full-folder test run failed while isolated file passed | Moved init state inside `createLocalTranslatorHook` per instance |
| 3 | Skip rules ran AFTER `ensureOllamaReady` | Short/path-only messages still triggered health checks, model pulls, and (with default `autoInstall: true`) an actual `curl \| sh` Ollama install attempt | `shouldSkipTranslation` exported and checked in hook before readiness; wiring test asserts zero network |
| 4 | `ensureOllamaReady` ignored `ensureModelPulled` result on the healthy branch | Claimed ready with no model | Returns the pull result |
| 5 | `hook.test.ts` configs left `autoInstall` default true | Test suite could spawn a real Ollama installer | `autoInstall: false` in all three hook tests |
| 6 | `dist/` was stale (pre-local-translator) after 7B commit | Bundle lacked the feature | `bun run build` rerun, contents verified |

## Environment limitations (not wiring defects)

- opencode `1.18.25` on this host does not invoke external plugin `server()`
  factories in run/serve (proven for every momo hook in
  `.omo/evidence/20260828-repo-map-injector/`, 608-request dump, 0 injections).
  Live drives therefore cannot show these hooks firing; the sanctioned proof
  path is the in-process harness above (`createTransformHooks` +
  `createMessagesTransformHandler`), the exact invocation path the dist bundle
  uses.
- Codegraph MCP calls time out on this host (`MCP error -32001`); wiring is
  correct per source inspection. Separate debug task.
- Ollama is not installed on this host; QA used a fake HTTP server. First real
  message with `auto_install: true` will install + pull (progress bar), or pass
  through unchanged if install fails.

## Boundaries honored

- No prompt-prose assertions in committed tests.
- Real opencode DB untouched (no opencode spawned during this QA; no XDG
  sandbox needed).
- No `as any`/`@ts-ignore`; no empty catch (error paths log via `shared/logger`).
