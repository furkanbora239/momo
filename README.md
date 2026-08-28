# momo — My Oh My Openagent

> **MODIFIED SOFTWARE NOTICE** — This repository is a token-efficient, substantially modified fork of [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) ("oh-my-opencode" / "oh-my-openagent" upstream). It is distributed under the original [Sustainable Use License 1.0](./LICENSE.md) (SUL-1.0, **not** OSI open source). The original upstream README is preserved at [README.upstream.md](./README.upstream.md).

**momo** is a token-efficient, **cheap-provider-first** agent harness and plugin for OpenCode. Optimized with out-of-the-box defaults for `opencode-go` + `neuralwatt`, while supporting any number of connected AI providers.

---

## 🎯 Purpose & Philosophy (Where It Came From & Where It's Going)

The upstream project is tuned for a heavy roster of flagship frontier models: 11 distinct agents, 54+ lifecycle hooks, always-on MCPs, and extensive per-model orchestrator prompts. For everyday coding and iterative workflows, that architecture tends to over-delegate simple reasoning to expensive models and burns excessive tokens.

**The momo "North Star":**
> **A cheap orchestrator that plans, delegates aggressively to cheaper subagents, picks subagent models at runtime from a live catalog, and emits as few output tokens as possible. Big models act as bound-on-demand advisors, never default executors.**

- **Delegation over implementation** — The orchestrator acts as a director, not a raw coder.
- **Cheapest adequate model** — Subagent models are selected per task (speed, vision, reasoning, cost) from a live provider catalog.
- **Strict token discipline** — Minimal orchestrator verbosity, pruned hooks, MCPs loaded on-demand, and telemetry disabled by default.
- **Zero-config start** — Install, choose your model via `/models`, and go. Power users can configure fine-grained overrides in `~/.omo/omo.jsonc`.
- **No surprise billing** — Expensive frontier models are never silently auto-selected; they are bound on demand.

---

## ✨ Key Features & Enhancements

### 1. Local Prompt Translator (Ollama Integration)
Every incoming user prompt (Turkish, English, or any language) is intercepted before reaching the primary model via the `experimental.chat.messages.transform` hook and routed to a **local Ollama model** (default: `qwen2.5:1.5b`).

- **What it does:** Translates prompts to English and compresses them into a concise "Caveman" style (stripping filler, pleasantries, and articles while preserving technical terms, code snippets, file paths, and URLs verbatim).
- **Why it matters:** English is significantly more token-dense in LLM tokenizers. Compressing the prompt dramatically lowers input token consumption across every conversation turn.
- **Automated Ollama Lifecycle:** If Ollama is not present, momo automatically installs Ollama, pulls `qwen2.5:1.5b` (with terminal download progress), and spins up the local daemon.
- **Finetuning Pipeline:** All translation I/O (inputs, outputs, model tag, latency) is logged locally to `~/.omo/local-translator-logs/<date>.jsonl` to build a curation dataset for specialized future small models.

### 2. Ponytail / Caveman System Prompt Optimization
The shared prompt builders and system instructions have been restructured:
- **Caveman Style:** Redundant conversational prose and lengthy examples have been compressed into crisp, directive bullet points.
- **Ponytail YAGNI Ladder:** Enforces the principle *"Lazy about the solution, never about reading"*. Models climb a strict priority ladder:
  1. Does this need to exist? (YAGNI)
  2. Already in this codebase? (Reuse)
  3. Standard library covers it?
  4. Native platform feature?
  5. Installed dependency?
  6. Can it be done in one line?
  7. Only then: minimal code that works.

### 3. Live Model Catalog MCP (`catalog`)
A built-in Tier-1 stdio MCP server providing real-time provider model discovery:
- `catalog_list`: Discovers connected models across all configured providers along with metadata (cost, context window, modalities).
- `catalog_pick`: Local heuristic matcher (no LLM call) resolving the cheapest adequate model for a given task requirement (`speed` → flash-tier, `reasoning` → pro/max-tier, `vision` → vision-enabled).
- `catalog_refresh`: Re-syncs live models per session.

### 4. On-Demand Advisor Role
Expensive models (e.g. Claude Opus, GPT-4) never execute code by default. When complex architectural decisions or stubborn bugs arise, the user or orchestrator can bind an advisor:
```bash
/advisor neuralwatt/glm-5.2   # Bind an advisor for the current session
/advisor off                  # Unbind advisor
```
The advisor receives a distilled brief (goal, attempted solutions, blocker) and outputs short, steering directives rather than voluminous code changes.

### 5. Repo-Map Auto-Injector
When a project contains a `.codegraph` SQLite index, momo generates an Aider-style compressed codebase summary (file hierarchy + high-centrality symbol signatures) and injects it once into the initial turn. This eliminates dozens of costly exploratory search tool calls.

---

## 🚀 Installation & Setup

### Prerequisites
- **[Bun](https://bun.sh/)** (Required for building and running the workspace; do not use npm/yarn/pnpm for the root).
- **[OpenCode CLI](https://opencode.ai/)**

### Steps

1. **Clone the Repository & Install Dependencies:**
   ```bash
   git clone https://github.com/furkanbora239/omo.git
   cd omo
   bun install
   ```

2. **Build the Plugin Bundle:**
   ```bash
   bun run build
   ```
   *(This bundles TypeScript modules, generates JSON schemas, and compiles the distribution under `./dist`.)*

3. **Register with OpenCode:**
   ```bash
   opencode plugin . --force
   ```
   *(This adds momo to your local `.opencode/opencode.json` and `.opencode/tui.json` configurations.)*

4. **Launch & Select Model:**
   ```bash
   opencode
   ```
   Run `/models` inside OpenCode to choose your main model. That selection automatically becomes your **orchestrator** with zero extra setup required. On your first prompt, Ollama will be verified and the local translator will activate.

---

## 🛠️ Development & Quality Assurance

Follow the strict codebase conventions documented in `AGENTS.md` and `plan.md`.

- **Typecheck:** Uses `tsgo` (`@typescript/native-preview`):
  ```bash
  bun run typecheck
  ```
- **Run Tests:**
  ```bash
  bun test packages/omo-opencode/src   # Fast targeted test suite
  bun test                             # Full root test suite
  ```

### `opencode-qa` Skill
The repository includes an isolated QA suite under `.agents/skills/opencode-qa/` for verifying runtime behaviour without touching your live OpenCode database:
- **Case A:** Non-interactive CLI verification (`opencode run --format json`).
- **Case B:** Server-Sent Events (SSE) hook probes proving plugin hooks trigger.
- **Case C:** Isolated TUI smoke testing under tmux.
- **Case D:** Read-only SQLite session inspection and forensic debugging.

---

## 📜 License

Original code © code-yeongyu and contributors.  
Distributed under the **[Sustainable Use License 1.0 (SUL-1.0)](./LICENSE.md)**:
- Free for **non-commercial, personal, and educational use and redistribution only**.
- Not OSI open source; relicensing (e.g. to MIT) is prohibited.
- All original copyright notices and the modification notice must be preserved.
