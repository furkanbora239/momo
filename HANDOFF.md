# HANDOFF — momo real-harness QA session (2026-09-01)

Goal: prove the momo fork (local `dist/index.js`, v5.0.0-beta.12) runs inside real
opencode 1.18.25 — roster slimming, advisor, catalog MCP, hooks. **DONE: the
harness runs end to end in both the QA sandbox and the user's real environment.**
User's normal opencode previously loaded npm `oh-my-openagent@4.19.3` (upstream);
now switched to the local momo dist.

## Verified findings

1. **OPENCODE_PURE=1 disables all external plugins.** opencode injects
   `OPENCODE_PURE=1`, `OPENCODE=1`, `OPENCODE_PID` into nested-session tool
   shells (e.g. an agent's bash tool). Any `opencode` spawned from there runs
   pure mode and skips `cfg.plugin_origins` entirely
   (`src/plugin/index.ts`: `plugins = flags.pure ? [] : cfg.plugin_origins`).
   Unset them with `env -u OPENCODE_PURE -u OPENCODE -u OPENCODE_PID` and
   plugins load fine on 1.18.25.
   -> plan.md's old "opencode 1.18.25 does not invoke external plugin server()
   factories" note was WRONG; it was this env var. CORRECTED in plan.md.

2. **Real momo bug found + fixed: V1 roster never applied.**
   `packages/omo-opencode/src/config/validate.ts` `mergeViews()` checked
   `config.disabled_agents === undefined`, but `mergeConfigs` ->
   `mergeUniqueStrings(undefined, undefined)` returns `[]`, so after the first
   view merge the field was always "defined" and the
   `V1_DISABLED_AGENTS_DEFAULT` injection never fired. Fix: decide from the raw
   views (`views.every(v => v.config.disabled_agents === undefined)`).
   Verified live: real-harness log shows `[config-handler] agents loaded
   {"agentKeys":["Sisyphus - ultraworker","advisor","build","explore",
   "librarian","plan"]}` — the 6-agent V1 roster, disabled agents absent.

3. **QA-sandbox config path trap (cost the previous session its probe).**
   opencode reads the global config from `$XDG_CONFIG_HOME/opencode/opencode.json`
   or `.jsonc` — NOT from `$XDG_CONFIG_HOME/opencode.json`. The old QA config
   sat at `/tmp/opencode/qa-sandbox/config/opencode.json` (ignored) while
   opencode actually loaded the stub
   `/tmp/opencode/qa-sandbox/config/opencode/opencode.jsonc` (only `$schema`).
   Symptoms this produced: defaults everywhere (title + main on
   `neuralwatt/qwen3.6-35b-fast`), `debug config` showed `plugin: []`.
   Fixed: full QA config now lives at
   `/tmp/opencode/qa-sandbox/config/opencode/opencode.jsonc`.

4. **file:// plugin loading works on 1.18.25 — but the dist bundle needs its
   external deps resolvable.** The bun bundle leaves runtime externals:
   `zod` (+ `zod/v3`, `/v4`, `/v4-mini` subpaths), `ajv/dist/runtime/*`,
   `ajv-formats`. From a bare dist copy with no `node_modules` above it, the
   import throws `Cannot find package 'zod'` and opencode SILENTLY skips the
   plugin: the loader publishes the error as a session event during init,
   before `opencode run` subscribes, so the run output shows nothing and
   opencode.log has no line either (only post-import shape errors are logged).
   Fix used in sandbox: copy `zod@4.4.3`, `ajv@8.20.0`, `ajv-formats@3.0.1`
   into `<plugin-dir>/node_modules/` (done for
   `/tmp/opencode/qa-sandbox/momo-dist/`). The repo dist needs nothing: the
   user's real config points at the repo path, where repo node_modules resolve.
   Debug probes that proved this live in `/tmp/opencode/qa-sandbox/*-probe.js`
   + `momo-proxy.js` (markers written on import).

5. **CJS plugins are rejected; ESM works.** A `module.exports = async () => {}`
   plugin fails with `Plugin export is not a function` (logged to opencode.log
   as `failed to load plugin`). ESM `export default async () => {}` works, both
   via `plugin` config entries (`file:///abs/path.js`, plain abs path, and
   `./relative` resolved against the declaring config) and via project
   auto-discovery `.opencode/plugin/*.js`. V1 shape `{ id, server }` as default
   export is detected and `server()` is invoked.

6. **Sandbox interference source: `~/.opencode/opencode.json`.** opencode
   ALWAYS walks `$HOME/.opencode/opencode.json` (not gated by
   `OPENCODE_DISABLE_PROJECT_CONFIG`, ignores XDG isolation). With the real
   switch (below) it is now empty.

7. **Real-env 402: the user's `~/.omo/omo.jsonc` sisyphus chain listed
   `neuralwatt/glm-5.2` FIRST.** momo's chain resolution picked it because
   neuralwatt appears in `provider.list()` (connected) even with zero credit;
   `runtime_fallback.retry_on_errors` = [401,403,429,500,502,503,504] excludes
   402, so no fallback fired and the session died. Fixed the user config:
   sisyphus chain reordered funded-first (`opencode-go/glm-5.2`, `go-b/glm-5.2`,
   then neuralwatt entries last) and `team_mode.enabled` -> false (its eligible
   members atlas/hephaestus/sisyphus-junior are disabled in the V1 roster
   anyway; momo log confirmed `teamModeEnabled:false, teamToolCount:0` after).
   Other agent/category chains in omo.jsonc already start with funded
   providers; prometheus/metis/momus/etc. overrides are inert (agents disabled).

8. **neuralwatt is out of credit** (user-confirmed): every `neuralwatt/*` call
   402s. QA must keep models on funded providers: `opencode-go/*` (real env,
   auth present) or `go-b/*` (custom provider, `OPENCODE_GO_B_KEY` env).

9. **Bun 1.3.14 proxy-env fetch poisoning (fixed in tests).**
   Setting `http_proxy`/`https_proxy` then `delete process.env.http_proxy`
   poisons later in-process `fetch` (ConnectionRefused even to 127.0.0.1).
   Restoring to `""` instead of deleting avoids it. Fixed in
   `cli/config-manager/bun-install.test.ts`.

10. **Plugin-relative skills path.** The bundled `dist/skills/*` resolves
    relative to the plugin file's location. Copy the whole `dist/` tree (the
    sandbox uses `/tmp/opencode/qa-sandbox/momo-dist/` with skills + node_modules).

11. **Parallel-agent noise.** Other sessions/agents may run opencode in this
    repo during QA; don't trust run-log attribution blindly. During this
    session the user's own TUI was running as PID 8082 with `--pure` (loads no
    plugins at all) — unaffected by any config edits until restart.

12. Host quirk (not a momo bug): `inotify_add_watch ... .git failed: No space
    left on device` (watch limit exhausted on this host) appeared in the momo
    log during the real run; harness kept running.

## Real switch (DONE, user consented)

- `~/.config/opencode/opencode.json`: `plugin` ->
  `["file:///home/furkanbora/code/ai/momo/dist/index.js"]`
  (backup: `/tmp/opencode/real-switch-backup/config-opencode.json`).
- `~/.opencode/opencode.json`: emptied to `{"$schema": ...}` (backup kept).
- `~/.opencode/tui.json`: emptied to `{}` (backup kept).
- Removed: `~/.opencode/node_modules/oh-my-openagent{,-linux-x64,-linux-x64-baseline}`,
  `~/.cache/opencode/packages/oh-my-openagent@*` (npm upstream copies).
- `~/.omo/omo.jsonc`: sisyphus chain reordered funded-first; `team_mode.enabled`
  -> false (backup: `/tmp/opencode/real-switch-backup/omo.jsonc`).

## Real-env verification (PASSED)

`env -u OPENCODE_PURE ... opencode run "Reply with the single word: ready"`
in the repo (real XDG, real DB):

- Title: `opencode-go/deepseek-v4-flash` (small_model honored, no 402).
- Main: `opencode-go/glm-5.2`, agent `Sisyphus - ultraworker` (session-model
  inheritance + omo.jsonc chain fix).
- Reply `ready`; 30.8k input tokens (orchestrator system prompt injected);
  cost $0.043.
- momo log: ENTRY, V1 roster (6 agents), tool registry 14 tools
  (teamModeEnabled:false), connected-providers cache (5 providers), command
  count 29.
- Two run-mode sessions were created in the real DB during QA (one 402-failed
  probe, one successful smoke test) — acceptable pollution, disclosed here.

## Sandbox verification (PASSED)

Same recipe with isolated XDG + fake HOME (`/tmp/opencode/qa-home`, which has
`.omo/omo.jsonc` with team_mode disabled):

- QA config: `/tmp/opencode/qa-sandbox/config/opencode/opencode.jsonc`
  (model `go-b/glm-5.2`, small_model `go-b/deepseek-v4-flash`, plugin
  `file:///tmp/opencode/qa-sandbox/momo-dist/index.js`).
- Orchestrator ran on `go-b/glm-5.2`; title on `go-b/deepseek-v4-flash`;
  V1 roster; connected-providers cache 4 providers / 98 models;
  model-capabilities cache 3381 models; ast-grep provisioned to qa-home.

## Working QA recipe (CORRECTED — mind the config path)

```bash
# 1. QA config MUST be at $XDG_CONFIG_HOME/opencode/opencode.jsonc
#    (/tmp/opencode/qa-sandbox/config/opencode/opencode.jsonc)
# 2. Unset the nested-session env vars so plugins load.
env -u OPENCODE_PURE -u OPENCODE -u OPENCODE_PID \
  XDG_CONFIG_HOME=/tmp/opencode/qa-sandbox/config \
  XDG_DATA_HOME=/tmp/opencode/qa-sandbox/data \
  XDG_STATE_HOME=/tmp/opencode/qa-sandbox/state \
  XDG_CACHE_HOME=/tmp/opencode/qa-sandbox/cache \
  HOME=/tmp/opencode/qa-home \
  opencode run "..." --format json
```

Plugin dir: `/tmp/opencode/qa-sandbox/momo-dist/` (full dist tree +
node_modules {zod, ajv, ajv-formats}). Diagnostics: `opencode debug config`
(see merged model/plugin/plugin_origins), `opencode debug v2` (bundled
providers + small-model map).

## Committed state

- Commit `59b7e8746` on `dev`: validate.ts mergeViews fix + 2 regression tests
  (no-view / explicit-list), bun-install proxy-restore fix, plan.md
  OPENCODE_PURE correction.
- Gates: `bun run typecheck` green; focused suites green (722 pass at handoff
  time); full suite last known: 8393 pass + 3 known env-dependent
  `codex-components` doctor fails (documented in plan.md, unrelated).
- `dist/index.js` rebuilt (contains fix); HANDOFF.md untracked (session doc).

## Open items / next steps

1. **Restart the user's TUI** to pick up the new plugin config (the running
   instance predates the switch; it uses `--pure` so it never loaded plugins
   anyway).
2. **Deployment story for bare dist copies**: any non-repo deployment of
   `dist/index.js` must ship `node_modules` (zod, ajv, ajv-formats) next to it,
   or the build should inline them. Consider a `bun run build:portable` that
   emits dist + the three deps, and a doctor check that warns when externals
   are unresolvable (the current failure is 100% silent to users).
3. **Silent plugin-load failure UX**: init-time `publishPluginError` is
   invisible in `opencode run` output (fires before the run subscribes).
   Consider a momo-side `session.status`-based self-check, or at minimum a
   doctor check ("is the plugin actually loaded?") using the momo log ENTRY
   line.
4. **402 hardening (momo-side follow-up)**: a chain head on an unfunded
   provider hard-fails because `runtime_fallback.retry_on_errors` (user
   config, and possibly momo defaults) excludes 402. Consider adding 402 to
   the default retry list in `packages/model-core` fallback defaults, and/or
   catalog-aware chain pruning (drop providers that recently 402'd).
5. plan.md follow-ups unchanged: token-burn live chat evidence, Ollama
   real-harness experience, A/B eval, `/advisor`.
6. Doctor test env fails (`codex-components`, 3 tests) remain environment-
   dependent (sg/PATH), documented in plan.md.

## Key paths

- Repo: `/home/furkanbora/code/ai/momo`; build entry `dist/index.js`
  (+ `dist/skills`, relies on repo `node_modules` for zod/ajv/ajv-formats).
- Plugin log: `/tmp/oh-my-opencode.log` (shared, append-only; check tail by
  timestamp; the logger buffers 500 ms / 50 lines, so very short-lived runs
  can lose lines).
- QA sandbox: `/tmp/opencode/qa-sandbox/{config/opencode/opencode.jsonc,data,
  state,cache}`; fake HOME `/tmp/opencode/qa-home`; plugin dir
  `/tmp/opencode/qa-sandbox/momo-dist/`.
- Config backups: `/tmp/opencode/real-switch-backup/`.
- opencode: `~/.local/bin/opencode` v1.18.25; user configs:
  `~/.config/opencode/opencode.json` (global, now momo dist), `~/.opencode/
  opencode.json` (empty), `~/.omo/omo.jsonc` (omo overrides, sisyphus chain
  fixed, team_mode off), `~/.local/share/opencode/opencode.db` (real DB —
  60 sessions at QA start + 2 QA sessions created this session).
