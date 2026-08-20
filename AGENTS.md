# AGENTS.md — omo (DeepSeek-optimized fork)

DeepSeek-first fork of [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
(upstream npm: `oh-my-opencode` / `oh-my-openagent`). An agent harness that extends
OpenCode with an orchestrator + subagents, `ulw-loop`, team mode, and background agents.

**North star:** a cheap orchestrator that plans, delegates aggressively to cheaper
subagents, and emits as few output tokens as possible. DeepSeek V4 (Pro/Flash) is the
first-class target.

## License (fork-critical)

SUL-1.0 "Sustainable Use License" (`LICENSE.md`) — **not** OSI open source.
- Keep all upstream copyright/license notices; add a prominent "MODIFIED" notice.
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

- `packages/omo-opencode/` — OpenCode plugin (entry `src/index.ts`)
- `packages/omo-codex/` — Codex CLI "Light" edition
- `packages/omo-senpi/` + `packages/senpi-task/` — Senpi native engine
- `packages/omo-native/` — native `omo` CLI distribution
- `packages/{prompts-core,delegate-core,model-core,rules-engine,hashline-core,team-core,...}` — harness-neutral core

## DeepSeek work — where to change things

The orchestrator prompt is **per-model variant files**, not one prompt:

- `packages/omo-opencode/src/agents/sisyphus/*.ts` — `claude-opus-5.ts`, `kimi-k3.ts`,
  `glm-5-2.ts`, `default.ts`, … **no `deepseek.ts` yet**. DeepSeek falls through to
  `default.ts` (Claude-tuned). `sisyphus-agent-factory.ts` resolves the variant with a
  chain of `isXModel()` checks; add `deepseek.ts` + one branch there.
- `packages/prompts-core/prompts/{ultrawork,prometheus,atlas,mode}/*.md` — mode prompts,
  also per-model variants (add DeepSeek variants here too).
- `packages/delegate-core/src/model-selection.ts` — subagent category→model routing.
- `packages/omo-opencode/src/tools/delegate-task/constants.ts` — `DEFAULT_CATEGORIES` /
  `CATEGORY_MODEL_REQUIREMENTS`.

**Model mapping is config, not code.** The user's `~/.omo/omo.jsonc` `[opencode]` block
(agents, categories, `fallback_models`) already remaps any agent/category to any model.
Prefer config over code unless you are changing prompt semantics.

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
takes effect — a green typecheck is not behavioral proof.

## References

- `README.md` (this fork) / `README.upstream.md` (original)
- `notes/deepseek-harness.md` — DeepSeek Harness (`dsh`) tracking note
- `packages/*/AGENTS.md` — per-package details (upstream, still accurate)
