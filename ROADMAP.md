# ROADMAP — momo (My Oh My Openagent)

**momo** is a token-efficient, cheap-provider-first agent harness for OpenCode.
Forked from `oh-my-openagent` / `oh-my-opencode`.

**North Star**: A lightweight orchestrator that plans, delegates aggressively to cheaper subagents, picks subagent models at runtime from a live catalog (`catalog_pick`), and emits as few output tokens as possible. Zero-config start: OpenCode `/models` selection is the main model. Optimized for high-throughput, low-cost model providers (opencode-go, neuralwatt).

---

## Progress & Phases

### Phase 1: Developer Experience & Fast Build Pipeline (COMPLETED)
- [x] **Fast Build (`bun run build:fast`)**: Compiles `dist/index.js` in **~150ms** directly from `packages/omo-opencode/src/index.ts`.
- [x] **Live Rebuilding (`bun run dev`)**: Added `--watch` mode for live bundle recompilation on save.
- [x] **Build Graph Optimization (`script/build.ts`)**: Bypassed heavy Codex/Senpi nodes during OpenCode builds, dropping full build time from >2 minutes to **15 seconds**.
- [x] **Stale Dist Alert (F7)**: Added runtime bootstrap warning in `createPluginModule` and diagnostic check in `omo doctor` flagging when source files are newer than `dist/index.js`.
- [x] **Test Isolation**: Isolated `homeDir` in `codex-components.ts` so machine environment (`~/.omo/runtime/ast-grep`) does not fail doctor unit tests.
- [x] **Clean Fast Test Suite (`script/test-fast.ts`)**: Removed Senpi from the default fast test group. Full OpenCode suite: **9,063 tests PASS, 0 FAIL**. Monorepo typecheck: **0 ERRORS**.

### Phase 2: Configuration & Doctor Health (COMPLETED)
- [x] **Valid User Config (`~/.omo/omo.jsonc`)**: Added `local_translator` to `OmoConfigSchema` and `OmoConfigLayerSchema` so user configs with custom translator/cloud settings pass Zod validation without rejection.
- [x] **Informative Loader Diagnostics**: Improved `validationDiagnostic` in `loader.ts` so root issues or missing keys print informative descriptions rather than blank error strings.
- [x] **Local Development Detection**: Updated `system-plugin.ts` and `tui-plugin-config.ts` to recognize `file:///.../momo/dist/index.js` entries in `opencode.json`.
- [x] **`omo doctor` Health**: Runs all 9 diagnostic checks in 2 seconds and exits 0 with `✓ System OK`.

### Phase 3: Prompt Diet & Orchestrator Streamlining (IN PROGRESS)
- [ ] **Unified MOMO Orchestrator Prompt**:
  - Replace monolithic 20KB–32KB per-model prompts (`gpt-5-5.ts`, `claude-opus-5.ts`, `kimi-k3.ts`) with the compact, unified MOMO orchestrator prompt (`sisyphus/momo-orchestrator.ts`).
  - Strict delegation mandate: The orchestrator *never* self-implements substantive code; it breaks tasks into atomic units and delegates via `task(category=..., model=...)`.
  - Minimal output style: Emit as few output tokens as possible. No self-narration or verbose conversational filler.
  - Save ~25,000 prompt tokens per chat turn.

### Phase 4: Token-Burn Pruning & Tool Overhead (W6 / F13 / F14)
- [ ] **Default-Off Chat Injection Hooks**:
  - Keep chat-turn reminders disabled by default (`agentUsageReminder`, `categorySkillReminder`, `todoDescriptionOverride`).
  - Prune rules injector verbosity to avoid polluting small-context models.
- [ ] **Tool Schema & Description Trimming (Wave 6)**:
  - Trim verbose multi-paragraph tool descriptions down to ≤600 characters per `notes/claude-code-patterns.md`.
  - Reduce JSON Schema payload overhead sent on every API invocation.

### Phase 5: Safe Repo Decoupling & Inactive Code Parking
- [ ] Safely park non-OpenCode adapters (`packages/omo-codex`, `packages/omo-senpi`, `packages/senpi-task`, `packages/pi-*`, platform wrappers) into an inert directory without losing prompts, agents, or reference implementations.
