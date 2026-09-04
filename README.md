# momo — My Oh My Openagent

> **MODIFIED SOFTWARE NOTICE**  
> This repository is a token-efficient, cheap-provider-first modified fork of [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (upstream npm packages: `oh-my-opencode` / `oh-my-openagent`).  
> Distributed under the original [Sustainable Use License 1.0 (SUL-1.0)](./LICENSE.md) (**not** OSI open source).  
> The original upstream README is preserved at [README.upstream.md](./README.upstream.md).

---

<div align="center">

# 🚀 momo
### The Token-Efficient, Multi-Model Agent Harness for OpenCode

**Stop burning your budget on simple coding tasks.**  
momo transforms OpenCode into a high-performance, cost-effective development team: an orchestrator that plans and delegates aggressively to cheap subagents, compresses prompts locally with Ollama, and calls flagship models strictly on demand.

[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-369eff?style=flat-square&logo=opencode)](https://opencode.ai)
[![Runtime Bun](https://img.shields.io/badge/Runtime-Bun-f472b6?style=flat-square&logo=bun)](https://bun.sh)
[![License SUL-1.0](https://img.shields.io/badge/License-SUL--1.0-yellow?style=flat-square)](./LICENSE.md)

</div>

---

## 📖 Table of Contents

- [💡 Why momo?](#-why-momo)
- [🏗️ How It Works (Architecture)](#️-how-it-works-architecture)
- [✨ Core Features & Capabilities](#-core-features--capabilities)
- [🤖 Streamlined Agent Roster](#-streamlined-agent-roster)
- [📦 Prerequisites](#-prerequisites)
- [🚀 Quick Start & Installation](#-quick-start--installation)
- [⚙️ Configuration Guide (`omo.jsonc`)](#️-configuration-guide-omojsonc)
- [💬 Slash Commands & Daily Usage](#-slash-commands--daily-usage)
- [🛠️ Developer & Contributor Guide](#️-developer--contributor-guide)
- [📂 Codebase Layout](#-codebase-layout)
- [📜 License & Attribution](#-license--attribution)

---

## 💡 Why momo?

Standard AI coding harnesses send massive context windows, entire project trees, and lengthy conversation histories to expensive frontier models (such as Claude Opus 5 / Claude Sonnet 5, GPT-5.6 Sol / GPT-5, or Gemini 3 Pro) on every single turn. For basic edits, typos, minor bug fixes, and routine functions, this consumes millions of unnecessary tokens and runs up huge API bills.

**momo is built around a single North Star:**

> **A cheap, lightweight orchestrator that plans, delegates aggressively to low-cost subagents, selects models dynamically at runtime from a live catalog, and uses a local small model to compress prompts before sending them to the cloud. Flagship frontier models act solely as bound-on-demand advisors.**

### Core Principles:

1. **Delegation Over Direct Implementation:** The orchestrator acts as a technical lead. It investigates, crafts a plan, and delegates tasks to specialized subagents instead of consuming expensive output tokens writing boilerplate directly.
2. **Cheapest Adequate Model:** Subagent models are selected per-task at runtime (speed, code generation, visual UI, reasoning) from a live provider catalog (`catalog_pick`).
3. **Local Translation & Token Discipline:** Prompts are translated to English and condensed into terse "Caveman" style locally via Ollama (`qwen2.5:1.5b` or `gemma3:1b`) before any cloud API call.
4. **Zero-Config Start:** Simply install, run `/models` in OpenCode, choose your preferred model, and start coding immediately. No mandatory config files.
5. **No Surprise Costs:** Frontier models are never called automatically in failure loops; you bind them explicitly when you need high-level architectural advice.

---

## 🏗️ How It Works (Architecture)

```
                       ┌────────────────────────────────────────┐
                       │ User Prompt (Any Language / Long Text) │
                       └───────────────────┬────────────────────┘
                                           │
                                           ▼
                       ┌────────────────────────────────────────┐
                       │   Local Translator (Ollama / Qwen)     │
                       │   -> Translates to English & Compresses│
                       └───────────────────┬────────────────────┘
                                           │
                                           ▼
                       ┌────────────────────────────────────────┐
                       │    Main Model (Orchestrator)           │
                       │    -> Reads Repo-Map & Creates Plan    │
                       └───────┬────────────────────────┬───────┘
                               │                        │
        [Routine Subtasks]     │                        │  [Complex Stuck Bugs]
                               ▼                        ▼
      ┌──────────────────────────────────┐    ┌────────────────────────┐
      │   Live Model Catalog MCP         │    │   On-Demand Advisor    │
      │   (`catalog_pick`)               │    │   (e.g., Opus / Max)   │
      │   -> Cheap Subagents (Fast/Code) │    │   via `/advisor`       │
      └──────────────────────────────────┘    └────────────────────────┘
```

---

## ✨ Core Features & Capabilities

| | Feature | Description & Benefits |
| :---: | :--- | :--- |
| ⚡ | **Local Prompt Translator** | Intercepts user prompts before cloud submission. A local model (e.g. Qwen 2.5 1.5B via Ollama) translates foreign languages to English and compresses text into dense "Caveman" style, slashing both input and output token costs. |
| 🗂️ | **Live Model Catalog (`catalog` MCP)** | Queries all connected providers dynamically at session startup (`client.provider.list()`). Selects the cheapest capable model via heuristic capability matching (`catalog_pick`). |
| 🧠 | **On-Demand Advisor (`/advisor`)** | Frontier models stay unbound by default to eliminate surprise billing. When facing architectural roadblocks or tricky bugs, bind an advisor for concise, high-value guidance (<300 tokens). |
| 🧗 | **Ponytail YAGNI Solution Ladder** | Built-in system prompt discipline: models climb a strict ladder (YAGNI → reuse existing code → stdlib → native feature → existing dependency → 1 line → minimal code). |
| 🗺️ | **Repo-Map Auto-Injector** | Reads `.codegraph` SQLite indexes and injects a high-level summary of key files, symbols, and dependencies on turn 1, eliminating costly exploratory grep loops. |
| 🔗 | **Hash-Anchored Edits (Hashline)** | Every line read by an agent is tagged with a content hash (`LINE#ID`). Edits verify line hashes before saving, eliminating broken diffs and hallucinated edit positions. |
| 🛠️ | **Crafted LSP & AST-Grep Tools** | Built-in language server and tree-sitter AST tools provide instant diagnostics, definition lookups, and syntax-aware search across 25+ programming languages. |
| 👥 | **Parallel Background Subagents** | Spawns multiple subagents concurrently (`task(subagent_type=..., run_in_background=true)`), enabling uninterrupted parallel research and test runs. |
| 📐 | **Rules Engine & `AGENTS.md`** | Automatically loads project conventions, coding standards, and directory-scoped `AGENTS.md` instructions directly into the relevant agent context. |
| 💬 | **Comment & Slop Checker** | Strips out verbose AI pleasantries, generic apologies, and redundant inline commentary, keeping code clean and professional. |

---

## 🤖 Streamlined Agent Roster

momo simplifies the active agent roster to minimize context overhead. Legacy agents are preserved in the codebase for reference, but disabled by default:

```
                  ┌─────────────────────────────────────┐
                  │        momo Orchestrator            │
                  │   (Coordinates, Plans, Delegates)   │
                  └──────┬──────────┬──────────┬────────┘
                         │          │          │
         ┌───────────────┘          │          └───────────────┐
         ▼                          ▼                          ▼
┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
│     explore      │      │    librarian     │      │     advisor      │
│  Contextual Grep │      │  External Docs   │      │ Bound On-Demand  │
│  & Code Search   │      │  & OSS Research  │      │   Architecture   │
└──────────────────┘      └──────────────────┘      └──────────────────┘
```

### Active Roster:

1. **momo Orchestrator (Main Agent)**
   - **Role:** Technical Lead / Coordinator.
   - **Behavior:** Analyzes the repo map, clarifies requirements, builds executable task plans, and delegates to subagents.
   - **Model:** Zero-config — automatically inherits whatever model you selected in OpenCode (`/models`).
2. **explore (Codebase Search Specialist)**
   - **Role:** Fast contextual search inside your local repository.
   - **Trigger:** Locating symbol definitions, tracing references, finding relevant files.
3. **librarian (External Research Specialist)**
   - **Role:** External documentation lookups, library API references, and web searches.
   - **Trigger:** Researching third-party libraries, unfamiliar frameworks, or web resources.
4. **advisor (On-Demand Senior Architect)**
   - **Role:** High-level architectural decision-making, debugging stuck failure loops.
   - **Trigger:** Explicitly bound via `/advisor <model>`. Returns concise, decisive directives.

### Subagent Execution Categories:
When delegating work via `task()`, momo routes tasks to optimized categories:
- **`quick`:** Small single-file fixes, typos, and minor edits (uses fast flash-tier models).
- **`deep`:** Multi-file features, refactoring, and comprehensive implementation.
- **`visual-engineering`:** Frontend UI/UX, CSS styling, components, and layout design.
- **`ultrabrain`:** Complex algorithms, performance optimization, and difficult logic problems.

---

## 📦 Prerequisites

Before using momo, ensure your system has:

1. **[Bun](https://bun.sh/)** (version 1.1 or higher)  
   *Note: momo uses Bun for building and running. Do not use npm, yarn, or pnpm in the root workspace.*
2. **[OpenCode](https://opencode.ai/)** installed and accessible in your PATH (`opencode`).
3. *(Optional)* **[Ollama](https://ollama.com/)** for local prompt translation.  
   *(If missing, momo can automatically install Ollama and pull `qwen2.5:1.5b` on Linux/macOS on first run).*

---

## 🚀 Quick Start & Installation

### Step 1: Clone the Repository
```bash
git clone https://github.com/furkanbora239/momo.git
cd momo
```

### Step 2: Install Dependencies
```bash
bun install
```

### Step 3: Build the Plugin
```bash
bun run build
```
*This bundles TypeScript sources, compiles MCP servers, and prepares `./dist`.*

### Step 4: Add to OpenCode Configuration
Add the plugin path to your OpenCode configuration (e.g. `~/.config/opencode/opencode.json` or project-level `opencode.json`):

```json
{
  "plugin": [
    "/absolute/path/to/momo"
  ]
}
```

*Alternatively, you can link the package locally via `bun link`.*

### Step 5: Launch OpenCode
```bash
opencode
```
1. Press `/models` inside OpenCode to choose your primary model.
2. That model immediately becomes your **momo Orchestrator** with zero extra configuration.

---

## ⚙️ Configuration Guide (`omo.jsonc`)

momo works out of the box with zero configuration. To customize behavior, create or edit `~/.omo/omo.jsonc` (global) or `.opencode/oh-my-openagent.jsonc` (project-scoped):

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/furkanbora239/momo/dev/assets/oh-my-opencode.schema.json",

  // 1. Local Prompt Translator (Ollama)
  "local_translator": {
    "enabled": true,                 // Enable local prompt translation & compression
    "model": "qwen2.5:1.5b",          // Local Ollama model tag (or 'gemma3:1b')
    "ollama_host": "http://localhost:11434",
    "timeout_ms": 30000,
    "auto_install": true,            // Automatically install Ollama if missing (Linux/macOS)
    "min_length": 20,                // Skip messages shorter than 20 characters
    "log_translations": true         // Log inputs/outputs to ~/.omo/local-translator-logs/ for finetuning
  },

  // 2. Model Catalog MCP
  "catalog": {
    "enabled": true                  // Dynamic runtime model picker
  },

  // 3. Advisor Agent Binding (Optional default)
  "agents": {
    "advisor": {
      "model": "anthropic/claude-opus-5" // Or "openai/gpt-5.6-sol" / "google/gemini-3-pro"
    }
  },

  // 4. Category Routing Overrides (Optional)
  "categories": {
    "quick": {
      "model": "google/gemini-3-flash"
    },
    "deep": {
      "model": "opencode-go/glm-5.3-flash"
    },
    "ultrabrain": {
      "model": "openai/gpt-5.6-sol"
    }
  },

  // 5. Disabled Hooks (Optional token-saving optimization)
  "disabled_hooks": [
    // "todoDescriptionOverride"
  ]
}
```

---

## 💬 Slash Commands & Daily Usage

> 💡 **For full documentation and in-depth guides, see [HELP.md](./HELP.md) (English) or [KULLANIM_KILAVUZU.md](./KULLANIM_KILAVUZU.md) (Türkçe).**

| Command | Description |
| :--- | :--- |
| `/help [topic]` | Display comprehensive interactive help, command references, and guides. |
| `/models` | Select your primary model inside OpenCode (automatically sets the orchestrator). |
| `/advisor <model\|off\|report>` | Bind/unbind an on-demand senior advisor model (e.g. `/advisor anthropic/claude-opus-5`). |
| `/goal <objective> \| pause \| resume \| clear` | Set or manage a continuous execution loop goal until completion criteria are met. |
| `/refactor <target>` | Intelligent refactoring with LSP diagnostics, AST-grep, and TDD verification. |
| `/hyperplan [request]` | Adversarial multi-agent planning with cross-critique across 5 specialist categories. |
| `/start-work [plan]` | Start executing a planned work session with task breakdown and optional worktrees. |
| `/handoff [goal]` | Create a detailed context summary to resume work seamlessly in a fresh session. |
| `/remove-ai-slops` | Clean AI code smells, verbose commentary, and boilerplate code from changes. |
| `/stop-continuation` | Stop all active continuation mechanisms (goal loops, todo continuation, background tasks). |
| `/security-research` | Run team-mode security research audit with vulnerability hunters and PoC engineers. |
| `/remove-deadcode` | Remove unused code across the project with LSP-verified safety. |
| `omo doctor` | Run CLI diagnostics on connected providers, active models, catalog MCP, and plugin health. |


---

## 🛠️ Developer & Contributor Guide

### Common Development Commands

```bash
# Typecheck across all workspace packages (uses tsgo)
bun run typecheck

# Run OpenCode plugin test suite
bun test packages/omo-opencode/src

# Run complete workspace tests
bun test

# Rebuild distribution bundle
bun run build

# Regenerate configuration JSON schema
bun run build:schema
```

### Design Guidelines:
- **No catch-all files:** Never create `utils.ts`, `helpers.ts`, or `service.ts`. Keep modules focused and concise (~200 LOC soft limit).
- **Factory pattern:** Export factory functions `createXXX()` for tools, hooks, and agents.
- **Cross-runtime safety:** Use `packages/omo-opencode/src/shared/bun-spawn-shim.ts` for process spawning.
- **Testing:** Write `bun:test` specs using `given / when / then` blocks. Never assert raw authored prompt strings in tests.

---

## 📂 Codebase Layout

```
omo/
├── packages/
│   ├── omo-opencode/        # OpenCode plugin implementation (momo's core focus)
│   │   └── src/
│   │       ├── agents/      # Orchestrator, Advisor, and prompt builders
│   │       ├── config/      # Zod configuration schemas & validation
│   │       ├── features/    # Features (local-translator, repo-map, etc.)
│   │       ├── hooks/       # OpenCode lifecycle hooks
│   │       ├── mcp/         # Built-in MCP servers (catalog MCP, ast-grep, lsp)
│   │       ├── shared/      # Cross-runtime shims, loggers, and audit tools
│   │       └── tools/       # Tools (delegate-task, advisor, hashline)
│   ├── model-core/          # Model resolution, aliases, and capability maps
│   ├── delegate-core/       # Category-to-model delegation logic
│   ├── prompts-core/        # Shared system prompt components & Ponytail ladder
│   ├── rules-engine/        # AGENTS.md parsing & context injector
│   ├── hashline-core/       # Hash-anchored line editing engine
│   └── lsp-core/            # Language Server Protocol client & daemon
├── .agents/skills/          # Project skills and automated workflows
├── plan.md                  # Development plan and roadmap
└── LICENSE.md               # SUL-1.0 License terms
```

---

## 📜 License & Attribution

- **Original Project:** [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) by YeonGyu Kim and contributors.
- **License:** Distributed under the **[Sustainable Use License 1.0 (SUL-1.0)](./LICENSE.md)**.
  - **Free for personal, non-commercial, and educational use and redistribution.**
  - Commercial use requires upstream licensing.
  - Relicensing (e.g. to MIT or Apache) is strictly prohibited.
  - All original copyright notices and modification notices are preserved.

