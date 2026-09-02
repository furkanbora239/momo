# ROADMAP — momo (My Oh My Openagent)

> **North Star:** A token-efficient, cheap-provider-first agent harness tailored for OpenCode.
> Designed around a 2x opencode-go + 1x neuralwatt workflow, where a cheap orchestrator plans,
> delegates aggressively to cheaper subagents via runtime catalog selection, and emits as few
> tokens as humanly possible. Big models act as on-demand advisors, never default executors.

---

## 1. The Core Conflict: Why momo and omo Clash

`momo` was started as a fork of `oh-my-openagent` (upstream `oh-my-opencode` / `omo`).
However, their core architectures and philosophies are diametrically opposed:

| Dimension | Upstream OMO Philosophy | momo Target Philosophy | The Clash Point |
| :--- | :--- | :--- | :--- |
| **Scope & Target** | Universal multi-harness (OpenCode, Codex, Senpi, Native CLI, Pi, 45 packages). | Strictly OpenCode-focused (`omo-opencode` + core TS). | Heavy build nodes, irrelevant packages, broken test suites. |
| **Model Selection** | Static fallback chains, hardcoded provider lists, config overrides. | Orchestrator decides at runtime via live catalog (`catalog_pick`) -> `task(model=...)`. | Resolvers discarded explicit model parameters (F2, F3). |
| **Token Efficiency** | Huge system prompts (20k–30k tokens), continuous hook injections. | Aggressive token diet, concise prompts, minimal chat-turn injections. | Smaller models blow context/output tokens immediately (F6, F12, F13). |
| **Agent Hierarchy** | 15+ specialized agents, complex autonomous loops. | Lean 3-tier hierarchy: Orchestrator → Manager (`planner`/`executor`) → Workers. | Subagents were forbidden from delegating (F4); workers got disabled (F1). |
| **Development Loop** | Complex multi-package build emitting `dist/index.js`. | Fast, transparent, verifiable development without ghost bugs. | "Stale dist trap" where editing source does not reflect in OpenCode (F7). |

---

## 2. Decoupling & Optimization Roadmap

This roadmap outlines the phased plan to untangle momo from upstream OMO's baggage and achieve a clean, lean, high-performance architecture.

```
[Phase 1: Stabilization & Bug Fixes] (DONE)
                  │
                  ▼
[Phase 2: Developer Experience & Stale Dist Fix] (CURRENT)
                  │
                  ▼
[Phase 3: Prompt Diet & Token Pruning]
                  │
                  ▼
[Phase 4: Monorepo Decoupling & Deadweight Elimination]
                  │
                  ▼
[Phase 5: Pure momo Architecture (Clean Target State)]
```

---

### Phase 1: Stabilization & Delegation Repair (COMPLETED)
*Goal: Fix broken execution paths and establish provider-neutral runtime delegation.*

- [x] **F1: Sisyphus-Junior unbanned** (`config/validate.ts`) — Category tasks now spawn without crashing.
- [x] **F2: Explicit `task(model=...)` honored** (`subagent-resolver.ts`) — Named-agent delegation respects orchestrator model parameter.
- [x] **F3: Purged provider bias** — Static model lists deleted from `~/.omo/omo.jsonc`; hardcoded neuralwatt-first rungs reverted.
- [x] **F4: Wave 8 Managers landed** — `planner` and `executor` manager agents implemented with sync delegation and depth guards.
- [x] **F5: W2 Lean roster completed** — Heavy commands and non-essential skills disabled by default (`default-off-skills.ts`).
- [x] **F6: Local translator hardened** — Automatic retry with doubled token limit on thinking-model `MAX_TOKENS` exhaustion.
- [x] **W7 QA Verification** — Real harness tests passing in `.omo/evidence/20260902-wave-qa/` across all 5 proof dimensions.

---

### Phase 2: Developer Experience & Stale Dist Elimination (CURRENT)
*Goal: Remove the friction of building and verifying changes, eliminating the "Frankenstein confusion".*

- [ ] **F7: Build-vs-Dist Guard**
  - Add build-timestamp verification in `omo doctor` and at plugin bootstrap.
  - Print a clear, loud console warning if `packages/omo-opencode/src/` was modified after `dist/index.js`.
- [ ] **Fast OpenCode Build Script**
  - Add `bun run build:opencode` (or `bun run build:fast`) that ONLY bundles `packages/omo-opencode/src/index.ts` to `dist/index.js` without running Codex/Senpi/Materialize build nodes (under 500ms build time).
- [ ] **Automated Watch Mode**
  - Add `bun run dev` (running `bun build --watch packages/omo-opencode/src/index.ts --outdir dist`) for instant feedback during local development.

---

### Phase 3: Prompt Diet & Token Pruning (HIGH TOKEN IMPACT)
*Goal: Drastically cut token consumption on session start and across conversation turns.*

- [ ] **F12: Replace Monolithic Orchestrator Prompts**
  - Audit `packages/omo-opencode/src/agents/sisyphus/` (currently has 26KB–32KB prompt files for Opus/GPT-5).
  - Unify into a single, clean MOMO orchestrator prompt template (~2KB–4KB) that focuses strictly on tool calling, concise directives, and hard delegation.
  - Stop baking 30KB prompts for models like Gemini Flash, GLM, or Kimi.
- [ ] **F13: Audit & Prune Chat-Turn Hook Injections**
  - Audit all hooks in `packages/omo-opencode/src/plugin/hooks/create-transform-hooks.ts` and `create-session-hooks.ts`.
  - Default-off hooks that inject text into every message step (`agentUsageReminder`, `categorySkillReminder`, `todoContinuationEnforcer`).
  - Keep context clean and minimal.
- [ ] **F14: Wave 6 — Tool Schema & Description Trim**
  - Follow Claude Code patterns (`notes/claude-code-patterns.md`): trim tool definitions to ≤600 characters.
  - Simplify input schemas to reduce the system prompt overhead sent on every API turn.

---

### Phase 4: Monorepo Decoupling & Deadweight Elimination
*Goal: Untangle the monorepo so momo is not dragging along unused upstream harnesses.*

- [ ] **Isolate Non-OpenCode Adapters**
  - Decouple `@oh-my-opencode/omo-opencode` from its dependency on `@oh-my-opencode/omo-codex`.
  - Quarantine or disable packages: `packages/omo-codex`, `packages/omo-senpi`, `packages/senpi-task`, `packages/pi-goal`, `packages/pi-webfetch`, `packages/omo-native`, and 12 platform launcher packages.
- [ ] **Streamline Workspace Root**
  - Simplify root `package.json` workspaces and test runners so `bun test` only runs tests relevant to momo/OpenCode.
  - Eliminate the 3 pre-existing Codex-environment test failures from the test gate.

---

### Phase 5: Pure momo Architecture (Clean Target State)
*Goal: A simple, maintainable, autonomous agent harness tailored to the user's workflow.*

- [ ] **Zero-Config Main Model**: Fully reliable inheritance of the active OpenCode model via `/models`.
- [ ] **Dynamic Runtime Catalog**: Built-in Model Catalog MCP (`catalog_list`, `catalog_pick`) seamlessly routes subtasks to available cheap models without hardcoded assumptions.
- [ ] **3-Tier Execution Topology**:
  1. **Orchestrator**: High-level planner and reviewer.
  2. **Managers (`planner` / `executor`)**: Structured coordination.
  3. **Workers (`quick`, `explore`, `librarian`)**: Cheap, laser-focused execution.
- [ ] **Advisor on Demand**: Big models bound only when explicitly requested, with strict budget limits.
- [ ] **Transparent & Open-Source Clean**: Zero sensitive tokens, zero provider lock-in, fully understandable code structure.

---

## 3. Progress Tracking

| Phase | Milestone | Priority | Status |
| :--- | :--- | :--- | :--- |
| **1** | Delegation Repair & Core Fixes (F1-F6) | P0 | **DONE** |
| **2** | Stale Dist Warning & Fast Build (F7) | P0 | **NEXT** |
| **3** | Prompt Diet & Hook Pruning (F12-F14) | P1 | Planned |
| **4** | Monorepo Decoupling & Deadweight Isolation (F11) | P2 | Planned |
| **5** | Pure momo Architecture Finalization | P3 | Vision |
