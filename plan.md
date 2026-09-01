# Plan: momo — My Oh My Openagent

> A token-efficient, cheap-provider-first fork of [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent).
> Optimized defaults for opencode-go + neuralwatt; any number of providers supported.

## North star

A cheap orchestrator that plans, delegates aggressively to cheaper subagents, picks
subagent models at runtime from a live catalog, and emits minimal output tokens. Big
models act as **bound-on-demand advisors**, never default executors. Zero-config start:
the opencode `/models` selection is the main model.

Principles:

- **Delegation over implementation** — the orchestrator is a director, not a coder.
- **Cheapest adequate model** — subagent models are chosen per-task from a live catalog.
- **Token discipline** — minimal orchestrator output, pruned hooks, MCPs on demand,
  telemetry off by default.
- **Zero config to start** — install, pick a model via `/models`, go. Power users can
  override everything in `~/.omo/omo.jsonc`.
- **No surprises** — expensive models are never auto-selected; the user binds them on
  demand.

## Status

Phases 0-5 implemented; Phase 6 (docs) mostly done; Phase 7 implemented (code
level + in-process QA). Waves:

- [x] Wave 1 — Phase 0: momo identity, docs, license audit
- [x] Wave 2 — Phase 1: Model Catalog MCP (`catalog_list`/`catalog_pick`/`catalog_refresh`)
- [x] Wave 3 — Phases 2+3: zero-config main model, advisor + delegation gate + `/advisor`
- [x] Wave 4 — Phases 4A+5: v1 roster (legacy agents disabled by default, code kept),
      token-burn hook gates, orchestrator prompt rewrite (hard delegation +
      catalog-first + minimal output)
- [x] Wave 5 — catalog-first task() model param, plan-mode folding, repo-map
      auto-injector (Aider-style, from `.codegraph`), doctor + README docs
- [x] Wave 6 — Phase 7A: ponytail ladder + caveman-condensed shared prompt
      sections (commits a01431739; evidence `.omo/evidence/20260829-phase7-ponytail-local-translator/`)
- [x] Wave 7 — Phase 7B: prompt translator (Ollama translate+compress,
      I/O logging; commits b2f53faef + 926bc2054 + QA fixes; same evidence dir;
      2026-09-01 rework: cloud Gemma default + no-sudo install, evidence
      `.omo/evidence/20260901-local-translator-cloud/`)
- [ ] Deferred — token-burn live chat-session evidence (needs a real provider
      session; wiring verified by source inspection)

CORRECTED (was: "opencode 1.18.25 does not invoke external plugin `server()`
factories" — wrong). Root cause: opencode injects `OPENCODE_PURE=1` (plus
`OPENCODE=1`, `OPENCODE_PID`) into nested-session tool shells (e.g. an agent's
bash tool), and pure mode skips `cfg.plugin_origins` entirely
(`src/plugin/index.ts`: `plugins = flags.pure ? [] : cfg.plugin_origins`). Any
`opencode` spawned from inside such a shell runs plugin-less. Unset with
`env -u OPENCODE_PURE -u OPENCODE -u OPENCODE_PID` and external plugins load
fine on 1.18.25 (verified 2026-09-01, see HANDOFF.md). In-process wiring proof
(createPluginModule + transform-hook tests) still stands; see
`.omo/evidence/20260828-repo-map-injector/`.

## Workstream

### Phase 0 — Identity & repo hygiene

1. Rewrite `README.md` + `AGENTS.md`: drop "DeepSeek-first" framing; adopt the north
   star above. Keep SUL-1.0 + MODIFIED notice; add the **momo** identity.
2. Rework `notes/deepseek-harness.md`: keep as a reference note, but stop framing it as
   the fork's target. The fork is provider-agnostic, not DeepSeek-specific.
3. **Do not delete** any existing agent/adapter code. Keep codex/senpi/native adapters
   and all 11 agents in-tree; disable (not remove) the ones momo does not surface by
   default, so we can revisit or repurpose them later.
4. License audit: SUL-1.0 headers + MODIFIED notices intact in all kept files.

### Phase 1 — Model Catalog MCP (`catalog`, built-in Tier-1)

1. New `src/mcp/model-catalog.ts` registered in `createBuiltinMcps()`; extend
   `McpNameSchema` with `"catalog"`; honor `disabled_mcps`.
2. Server: small stdio MCP via `mcp-stdio-core` (same pattern as `ast-grep-mcp`). Data
   source: `client.provider.list()` at plugin init (connected providers + models),
   enriched with models.dev metadata opencode already ships (cost, context window,
   modalities). Cache **per session**; `catalog_refresh` re-fetches.
3. Tools:
   - `catalog_list(filter?: {provider?, capability?, tier?})` → models with
     cost/context/vision tags.
   - `catalog_pick(need: string)` → ranked model ids via local heuristics (no LLM call):
     speed→flash-class, vision→gemini-flash-class, reasoning→pro/max-class,
     default→cheapest adequate.
4. Config: `catalog.providers` (default: all connected), `catalog.prefer` hints (e.g.
   `"campaign:hy3"` → boost). N providers, no hardcoded list.

### Phase 2 — Zero-config main model

1. Orchestrator agent ships with **no pinned model** → inherits opencode session model
   (`/models` selection); verifiable via `client.session.get()` → `session.model`.
2. Runtime fallback chains resolve against the catalog (connected models only); dead
   fallbacks pruned automatically.
3. Config overrides for agents/categories remain for power users (current
   `~/.omo/omo.jsonc` shape unchanged).

### Phase 3 — Advisor role (big model on demand)

1. `advisor` agent registers by default; **delegation is gated at task time** —
   unbound advisor calls are rejected with binding instructions (zero surprise
   cost). Binding: native `advisor` tool (session-scoped, via `/advisor`
   command) takes precedence over `agents.advisor.model` config.
2. Triggers (per user decision): orchestrator initiative (prompt-guided), manual
   command/keyword, plan-review phase. No automatic failure-loop escalation in v1;
   existing retry hooks only *suggest* the advisor.
3. Token discipline: advisor receives a distilled brief (goal, what was tried, error),
   never the full transcript; prompt caps output to short directives (target <300
   tokens).

### Phase 4 — Simplified agent topology (phased)

1. **Phase A (prompt + config, v1):** user-facing roster = orchestrator,
   `explore`+`librarian`, `task` categories, `advisor`. **Disable by default (keep
   code):** prometheus, metis, momus, hephaestus, oracle, atlas, sisyphus-junior,
   multimodal-looker. Fold prometheus planning into an orchestrator **plan mode**
   prompt variant.
2. **Phase B (v2, only if A under-delegates):** manager layer — `research-manager`
   owns explore/librarian, `exec-manager` owns task categories; orchestrator talks to
   ≤3 agents. Hierarchy decided by measured behavior, not up-front.
3. Orchestrator prompt rewrite (per-model variants auto-selected by model family from
   the session model id): hard delegation mandate (never self-implement beyond trivial
   edits), catalog-first model choice for every `task()` call, use of skills/slash
   commands on the user's behalf, minimal output style.

### Phase 5 — Token-burn pruning

1. Default-off heavy chat-injection hooks after audit (candidates:
   `agentUsageReminder`, `categorySkillReminder`, `rulesInjector` trimming,
   `todoDescriptionOverride`); each toggleable in config.
2. Defaults on: `experimental.aggressive_truncation`, `dynamic_context_pruning`;
   telemetry off by default.
3. Slim built-in MCP set: default-disable remote MCPs the user does not need
   (websearch/context7/grep_app stay opt-in); `lsp` + `catalog` on by default.

### Phase 6 — DX & docs

1. Zero-config install path verified: install → `/models` pick → works.
2. `omo doctor` reports: catalog contents per provider, advisor binding, active
   roster.
3. Docs: provider setup (opencode-go, neuralwatt, google), advisor usage, cost
   playbook.

### Phase 7 — Ponytail/Caveman prompt efficiency + local prompt translator

Two independent features that both serve the north star (minimal tokens, cheap
orchestration). Detailed implementation guide: [`plan-phase2.md`](./plan-phase2.md).

#### 7A — Ponytail/Caveman prompt rewrite

Inspired by [Ponytail](https://github.com/dietrichgebert/ponytail) (YAGNI ladder:
need to exist? → already in codebase? → stdlib? → native? → dependency? → one
line? → minimum that works) and [Caveman](https://github.com/juliusbrussee/caveman)
(terse prose: drop articles/filler/pleasantries, fragments OK, technical content
exact). These are complementary — Ponytail governs what you build, Caveman governs
how you talk (Ponytail's own README says so).

Scope: **shared sections + momo/default only** (not every model variant). All
variants import from the shared builders, so this propagates everywhere.

Files:
- `dynamic-agent-core-sections.ts` — condense 9 builder functions caveman-style;
  add new `buildPonytailLadderSection()` shared section.
- `dynamic-agent-policy-sections.ts` — condense `buildAntiDuplicationSection`
  (45+ lines → ~12) and `buildToolCallFormatSection`.
- `momo-orchestrator.ts` — integrate ponytail ladder, condense verbose blocks.
- `default.ts` — align with the same condense philosophy.

Key constraint (from Ponytail): **lazy about the solution, never about reading.**
Trace the real flow first, then climb the ladder. Never cut validation at trust
boundaries, error handling that prevents data loss, security, accessibility.

JetBrains benchmark caveat: Caveman's advertised 65% output-token cut measured
at ~8.5% on real agentic tasks (output-only). The real win is Ponytail's ~54%
less code from the YAGNI ladder. Both reduce prompt tokens (system prompt is
input tokens, re-sent every turn).

#### 7B — Prompt translator (2026-09-01: cloud default, no-sudo install)

A built-in feature that intercepts every user message via
`experimental.chat.messages.transform`, **translates to English + compresses**
(caveman-style: drop articles/filler, keep technical terms/code/paths exact).
The compressed English message then goes to the main model. This reduces both
input tokens (shorter prompt) and output tokens (English is more token-dense
than Turkish for most tasks, and compression helps further).

**Backend `mode` (2026-09-01 update):**
- `cloud` (default): free-tier Google Gemma `gemma-4-31b-it` via the native
  Gemini API (`:generateContent`). Key from `GOOGLE_API_KEY`/`GEMINI_API_KEY`
  env or OpenCode `auth.json` `google` entry; no key → graceful pass-through.
  Reasoning (`thought: true`) parts are dropped; only the final text is used.
- `local`: Ollama on this machine (`qwen2.5:1.5b` default, opt-in). Detection
  covers `~/.omo/ollama/bin/ollama` AND system Ollama on PATH.

**No sudo, ever.** The original silent `curl | sh` official-installer path is
removed: it spawned an interactive sudo password prompt over the user's TUI
(2026-09-01 incident, user typed their sudo password into the chat screen).
`auto_install` (default **false**) now only downloads the official Linux
tarball into `~/.omo/ollama` user-locally (`curl | tar`, no root). Per-step
re-translation is cached (mode+model+text key, 50 entries) — repeat LLM steps
get the cached translation at 0 ms instead of a 5-8 s round-trip.

Translation I/O logging is unchanged: every translation (input + output + model
label + latency + timestamp) appends to
`~/.omo/local-translator-logs/<date>.jsonl` for future finetuning; opt out via
`local_translator.log_translations: false`.

Files (feature module under `src/features/local-translator/`):
- `src/config/schema/local-translator.ts` — Zod config schema.
- `src/features/local-translator/types.ts` — translation result, config types.
- `src/features/local-translator/cloud-client.ts` — Gemini API client (key
  resolution, generateContent, thought-part filtering).
- `src/features/local-translator/ollama-client.ts` — HTTP client (localhost:11434).
- `src/features/local-translator/ollama-installer.ts` — system+local detection,
  no-sudo user-local install, daemon start.
- `src/features/local-translator/model-puller.ts` — auto-pull with progress bar.
- `src/features/local-translator/translator.ts` — mode routing, skip rules,
  cache, fallback.
- `src/features/local-translator/translation-logger.ts` — JSONL I/O log for finetuning.
- `src/features/local-translator/hook.ts` — messages.transform hook creator (per-mode readiness).

QA evidence: `.omo/evidence/20260901-local-translator-cloud/` (isolated XDG
sandbox run on real opencode; cloud translation verified live, cache hit at
0 ms, no ollama/sudo spawns, real DB untouched).

## Execution waves

- **Wave 1:** Phase 0 (docs, identity, license) — QA: `bun run typecheck` + `bun test`
  green, `bun run build` passes.
- **Wave 2:** Phase 1 (catalog MCP) — QA: opencode-qa evidence, `catalog_list` returns
  live provider models in an isolated session.
- **Wave 3:** Phases 2 + 3 (model inheritance, advisor) — QA: session-model
  inheritance proof via SSE; advisor bind + call e2e.
- **Wave 4:** Phases 4A + 5 (roster slimming, hook pruning) — QA: orchestrator
  delegation behavior driven via a real harness run.
- **Wave 5:** Phase 6 + release prep (doctor, docs, schema regen).
- **Wave 6:** Phase 7A (ponytail/caveman prompt rewrite) — QA: typecheck + test,
  real-harness evidence that ponytail ladder section appears in prompt.
- **Wave 7:** Phase 7B (local prompt translator) — QA: typecheck + test, Ollama
  auto-install + model pull verified, translation I/O logging verified.

## Verification gate

Every wave: `bun run typecheck` + `bun test` minimum. Prompt/behavior changes require
real-harness evidence per the `opencode-qa` skill (isolated XDG, no touching the real
user opencode DB). A green typecheck is not behavioral proof.

## Naming note

`momo` — "My Oh My Openagent". Deliberately a little unpolished. No dedicated
domain/site planned (open-source lives in the repo). No `momo` symbol/package name
collision exists in-tree (verified).

## Implementation progress (momo fork)

Tracked against the waves above. Verified with `bun run typecheck` (tsgo) and
`bun test` on `packages/omo-opencode`; the 3 failing tests in
`cli/doctor/checks/codex-components.test.ts` are environment-dependent (Codex
binary / `sg` resolution) and unrelated to these changes.

- **Wave 1 (Phase 0)** — done. `README.md` + `AGENTS.md` rewritten to the momo
  identity (provider-agnostic, SUL-1.0 + MODIFIED notice kept). `notes/deepseek-harness.md`
  demoted to a provider reference. License audit: `LICENSE.md` intact, MODIFIED
  notices present in `README.md`/`AGENTS.md`; no code deleted.
- **Wave 2 (Phase 1 — catalog MCP)** — done. New `src/mcp/model-catalog-server.ts`
  (stdio, `mcp-stdio-core`) with `catalog_list` / `catalog_pick` / `catalog_refresh`;
  `model-catalog.ts` builder + cli; registered in `createBuiltinMcps()`; `McpNameSchema`
  extended with `"catalog"`; `catalog` config schema (`enabled`/`providers`/`prefer`);
  schema asset regenerated; behavioral tests added.
- **Wave 3 (Phase 2 — zero-config main model)** — satisfied by existing behavior:
  the orchestrator inherits the opencode session model (`/models` selection) via
  `maybeCreateSisyphusConfig`/`uiSelectedModel`; no hard pin introduced.
- **Wave 3 (Phase 3 — advisor)** — done. New `agents/advisor.ts` (`createAdvisorAgent`)
  registered as built-in; **unbound by default** (skipped in `general-agents.ts` unless
  `agents.advisor.model` is configured). Added to `BuiltinAgentName`/`OverridableAgentName`
  enums + `AgentOverridesSchema`. Tests added. The `/advisor` runtime command is not
  yet wired.
- **Wave 4 (Phase 4A — roster slimming)** — done (config, not deletion). `validate.ts`
  injects the v1 disabled roster (`prometheus, metis, momus, hephaestus, oracle, atlas,
  sisyphus-junior, multimodal-looker`) when `disabled_agents` is omitted; `agent-config-assembly.ts`
  gates prometheus + sisyphus-junior on `disabled_agents` (they were added unconditionally).
- **Wave 5 (token-burn pruning)** — partial. `experimental.aggressive_truncation` and
  `dynamic_context_pruning` already exist; per-hook default-off toggles
  (`agentUsageReminder`, `categorySkillReminder`, `rulesInjector`, `todoDescriptionOverride`)
  are not yet wired as config gates. Telemetry remains off by default.
- **Wave 6 (doctor / docs / schema)** — partial. `omo doctor` gains a
  `momo Roster & Catalog` check (catalog status, advisor bound/unbound, active roster);
  schema regenerated. Full provider-setup docs and `omo doctor` narrative not written.

### Not yet done (Phase 0-6)
- `/advisor` command to bind a model from the catalog at runtime.
- Per-hook token-burn toggles (config-gated default-off heavy hooks).
- Real-harness `opencode-qa` evidence for catalog MCP + advisor (requires the opencode
  binary, isolated XDG, and connected providers).
- Codegraph MCP runtime performance (wiring correct per source inspection; MCP tool
  calls time out at runtime — separate debug task).

### Phase 7 — done at code level; follow-ups

Implemented and QA-verified (typecheck, 1088 focused tests, in-process wiring
proof via fake Ollama, prompt content dump). Evidence + QA bug log:
`.omo/evidence/20260829-phase7-ponytail-local-translator/verification.md`.
Remaining follow-ups:

- First real-harness Ollama experience (auto-install + model pull + real
  Qwen latency on CPU) on a machine with network; not possible here (no
  Ollama installed; the earlier "plugin-loading inertness" note was a
  misdiagnosis of OPENCODE_PURE=1 env poisoning — corrected 2026-09-01).
- A/B eval `gemma3:1b` vs `qwen2.5:1.5b` on ~20 real Turkish prompts
  (gemma3 is ~2x faster on CPU; see plan-phase2.md appendix).
- Curate `~/.omo/local-translator-logs/*.jsonl` outputs into a finetune
  corpus when enough good samples exist.
- Per-hook token-burn toggles + `/advisor` (carried from Phase 5/3).
