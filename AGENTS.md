# AGENTS.md — momo (My Oh My Openagent)

**momo** is a token-efficient, cheap-provider-first fork of
[oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (upstream npm:
`oh-my-opencode` / `oh-my-openagent`). An agent harness that extends OpenCode with an
orchestrator + subagents, `ulw-loop`, team mode, and background agents.

**North star:** a cheap orchestrator that plans, delegates aggressively to cheaper
subagents, picks subagent models at runtime from a live catalog, and emits as few
output tokens as possible. Big models act as bound-on-demand advisors, never default
executors. Zero-config start: the opencode `/models` selection is the main model.
Optimized defaults for opencode-go + neuralwatt; any number of providers supported.

## License (fork-critical)

SUL-1.0 "Sustainable Use License" (`LICENSE.md`) — **not** OSI open source.
- Keep all upstream copyright/license notices; add a prominent "MODIFIED" notice
  identifying this as the **momo** fork.
- Free non-commercial use + redistribution only; do **not** relicense (e.g. to MIT).

## Toolchain

- **Bun only** for the root workspace (never npm/yarn/pnpm) — EXCEPT the vendored
  Node-targeted packages built with npm: `packages/lsp-tools-mcp`, `packages/lsp-daemon`,
  `packages/ast-grep-mcp`, and `packages/omo-codex/plugin`.
- Typecheck uses **tsgo** (`@typescript/native-preview`), not `tsc`.

## Commands

```bash
bun test                          # full root suite (single process)
bun test <path/to/file.test.ts>   # one file
bun run test:fast                 # faster subset
bun run typecheck                 # tsgo across all packages
bun run build                     # ESM bundle of the OpenCode plugin
bun run build:schema              # regenerate assets/oh-my-opencode.schema.json
```

There is **no lint script**; the gate is `bun run typecheck` + `bun test`.
`test:codex` / `test:senpi` are separate heavy gates for those adapters.

## Layout (non-obvious)

The OpenCode plugin is **not** in a root `src/` — it lives in `packages/omo-opencode/src/`.
A refactor split the monorepo into ~20 pure-TS `*-core` packages + harness adapters:

- `packages/omo-opencode/` — OpenCode plugin (entry `src/index.ts`) — momo's focus
- `packages/omo-codex/` — Codex CLI "Light" edition (retained, not the focus)
- `packages/omo-senpi/` + `packages/senpi-task/` — Senpi native engine (retained, not the focus)
- `packages/omo-native/` — native `omo` CLI distribution (retained, not the focus)
- `packages/{prompts-core,delegate-core,model-core,rules-engine,hashline-core,team-core,...}` — harness-neutral core

momo surfaces the **OpenCode** adapter only by default. The other adapters are kept
in-tree (disabled, not deleted) so they can be revisited or repurposed later.

## momo work — where to change things

The fork's goals live in [`plan.md`](./plan.md). Key touchpoints:

### Orchestrator prompt variants (per model family)

- `packages/omo-opencode/src/agents/sisyphus/*.ts` — `claude-opus-5.ts`, `kimi-k3.ts`,
  `glm-5-2.ts`, `default.ts`, … `sisyphus-agent-factory.ts` resolves the variant from
  the **session model** (auto-selected by model family), not a hardcoded model. momo
  ships the orchestrator with **no pinned model** so it inherits the opencode `/models`
  selection. Add a variant per family as needed; do not pin.
- `packages/prompts-core/prompts/{ultrawork,prometheus,atlas,mode}/*.md` — mode prompts,
  also per-model variants.

### Model Catalog MCP (built-in Tier-1)

- `packages/omo-opencode/src/mcp/model-catalog.ts` (to add) + register in
  `createBuiltinMcps()` in `src/mcp/index.ts`; extend `McpNameSchema`.
- Data source: `client.provider.list()` at plugin init (connected providers + models),
  enriched with models.dev metadata. Cached **per session**.
- Tools: `catalog_list`, `catalog_pick` (local heuristics, no LLM call), `catalog_refresh`.
- `src/shared/connected-providers-cache.ts` and `src/shared/model-availability.ts`
  already call `client.provider.list()` — reuse this plumbing.

### Zero-config main model

- The orchestrator agent inherits the opencode session model. Verify via
  `client.session.get()` → `session.model.{providerID,id}` (see
  `src/features/btw-side/tui-session-bridge.ts`).
- Runtime fallback chains resolve against the catalog (connected models only).

### Advisor role (big model on demand)

- `advisor` agent (`src/agents/advisor.ts`) registers by default, but delegation
  to it is **gated at task time** (`src/tools/delegate-task/advisor-delegation-gate.ts`):
  unbound advisor calls are rejected with binding instructions — zero surprise cost.
- Binding precedence: session binding (native `advisor` tool,
  `src/tools/advisor/`, driven by the `/advisor` builtin command) >
  `agents.advisor.model` config. Session bindings live in
  `src/agents/advisor-binding.ts` (in-memory, per session).
- Triggers: orchestrator initiative, manual command, plan-review phase. No automatic
  failure-loop escalation in v1.
- Advisor receives a distilled brief, never the full transcript; output capped to short
  directives.

### Simplified agent topology (phased)

- Phase A (v1): user-facing roster = orchestrator + `explore`/`librarian` + `task`
  categories + `advisor`. Disable (keep code, do not delete) by default: prometheus,
  metis, momus, hephaestus, oracle, atlas, sisyphus-junior, multimodal-looker. Fold
  prometheus planning into an orchestrator plan-mode variant.
- Phase B (v2, only if A under-delegates): a manager layer so the orchestrator talks to
  ≤3 agents.

### Token-burn pruning

- Default-off heavy chat-injection hooks after audit (candidates:
  `agentUsageReminder`, `categorySkillReminder`, `rulesInjector` trimming,
  `todoDescriptionOverride`); each toggleable in config.
- Defaults on: `experimental.aggressive_truncation`, `dynamic_context_pruning`;
  telemetry off by default.

### Routing & config

- `packages/delegate-core/src/model-selection.ts` — subagent category→model routing.
- `packages/omo-opencode/src/tools/delegate-task/constants.ts` — `DEFAULT_CATEGORIES` /
  `CATEGORY_MODEL_REQUIREMENTS`.
- `packages/model-core/src/category-model-requirements.ts` — authoritative fallback chains.

**Model mapping is config, not code.** The user's `~/.omo/omo.jsonc` `[opencode]` block
(agents, categories, `fallback_models`) remaps any agent/category to any model. Prefer
config over code unless changing prompt semantics. momo adds catalog-driven runtime
selection on top of this.

## Conventions

- kebab-case files/dirs; `index.ts` barrel exports; **no catch-all files**
  (`utils.ts`/`helpers.ts`/`service.ts` banned); ~200 LOC soft cap.
- Factory pattern `createXXX()` for tools/hooks/agents.
- Relative imports within a module; barrel imports across modules; **no `@/` aliases**
  (except `packages/web/`).
- Tests: `bun:test`, given/when/then style; **never Arrange-Act-Assert comments**.
- No `as any`, `@ts-ignore`, `@ts-expect-error`, no empty `catch {}`, no emojis, no
  em-dashes or AI filler ("simply", "obviously").
- **Never assert authored prompt wording** in tests (prompt/prose contract tests are
  forbidden) — test routing/parsing/behavior instead.

## Verification

Typecheck + focused tests are the minimum. For prompt/behavior changes, drive the real
harness (`bunx oh-my-opencode run <msg>` or opencode) to confirm the change actually
takes effect — a green typecheck is not behavioral proof. Use the `opencode-qa` skill
for evidence (isolated XDG, no touching the real user opencode DB).

## References

- `README.md` (this fork) / `README.upstream.md` (original)
- `plan.md` — momo workstream, phases, and execution waves
- `notes/deepseek-harness.md` — reference note (not the fork's target)
- `packages/*/AGENTS.md` — per-package details
