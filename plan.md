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

Early work-in-progress. Not affiliated with the upstream project. Licensed SUL-1.0
(not OSI open source); the upstream license and MODIFIED notice are preserved.

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

1. New `advisor` agent: **unbound by default** (zero surprise cost); user binds at
   runtime via command (`/advisor` → pick from catalog) or config
   `agents.advisor.model`.
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

### Not yet done
- `/advisor` command to bind a model from the catalog at runtime.
- Per-hook token-burn toggles (config-gated default-off heavy hooks).
- Real-harness `opencode-qa` evidence for catalog MCP + advisor (requires the opencode
  binary, isolated XDG, and connected providers).
