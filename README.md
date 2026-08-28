# momo — My Oh My Openagent

> **MODIFIED SOFTWARE NOTICE**  
> This repository is a token-efficient, modified fork of [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (upstream packages: `oh-my-opencode` / `oh-my-openagent`).  
> Distributed under the original [Sustainable Use License 1.0 (SUL-1.0)](./LICENSE.md) (**not** OSI open source).  
> The original upstream README is preserved at [README.upstream.md](./README.upstream.md).

---

<div align="center">

# 🚀 momo
### The Token-Efficient, Multi-Model Agent Harness for OpenCode

**Stop paying hundreds of dollars for simple AI coding sessions.**  
momo transforms OpenCode into a high-performance, cost-effective development team.

[![OpenCode Plugin](https://img.shields.io/badge/OpenCode-Plugin-369eff?style=flat-square&logo=opencode)](https://opencode.ai)
[![Runtime Bun](https://img.shields.io/badge/Runtime-Bun-f472b6?style=flat-square&logo=bun)](https://bun.sh)
[![License SUL-1.0](https://img.shields.io/badge/License-SUL--1.0-yellow?style=flat-square)](./LICENSE.md)

</div>

---

## 📖 Table of Contents

- [💡 Why momo?](#-why-momo)
- [🏗️ How It Works (Architecture)](#️-how-it-works-architecture)
- [✨ Core Features & Capabilities](#-core-features--capabilities)
- [🤖 The Agent Roster & Delegation](#-the-agent-roster--delegation)
- [📦 Prerequisites](#-prerequisites)
- [🚀 Quick Start & Installation](#-quick-start--installation)
- [⚙️ Full Configuration Guide (`omo.jsonc`)](#️-full-configuration-guide-omojsonc)
- [💬 Slash Commands & Daily Usage](#-slash-commands--daily-usage)
- [🛠️ Developer & Contributor Guide](#️-developer--contributor-guide)
- [📂 Codebase Layout](#-codebase-layout)
- [📜 License & Attribution](#-license--attribution)

---

## 💡 Why momo?

Most AI coding harnesses send massive context windows and entire project files to expensive frontier models (such as Claude 3.7 Sonnet, Claude Opus, or GPT-4) on every turn. For basic edits, typos, and routine functions, this wastes thousands of tokens and runs up expensive bills.

**momo solves this with a "North Star" philosophy:**

> **A smart, cheap orchestrator that plans, delegates aggressively to low-cost subagents, picks subagent models dynamically from a live catalog, and uses a local small model to compress prompts before sending them to the cloud. Expensive models act only as on-demand advisors.**

### Core Principles:

1. **Delegation Over Implementation:** The orchestrator acts as a tech lead. It investigates, makes a plan, and delegates tasks to specialized subagents instead of writing everything itself.
2. **Cheapest Adequate Model:** Subagent models are picked at runtime per task (speed, vision, code, reasoning) from a live provider catalog (`catalog_pick`).
3. **Local Translation & Token Discipline:** Prompts are translated to English and compressed locally using Ollama (`qwen2.5:1.5b`) before cloud API calls. Unused hooks and telemetry are turned off by default.
4. **Zero-Config Start:** Install, run `/models`, choose your model, and start coding immediately.
5. **No Surprise Costs:** Frontier models are never called automatically without your explicit instruction.

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

| | Feature | What It Does & Why It Matters |
| :---: | :--- | :--- |
| ⚡ | **Local Prompt Translator** | Intercepts user prompts before cloud submission. A local Qwen model translates them to English and compresses them into terse "Caveman" style, slashing input token consumption across every turn. |
| 🗂️ | **Live Model Catalog (`catalog` MCP)** | Queries connected providers in real time (`client.provider.list()`). Selects the cheapest suitable model for subtasks via heuristic matching (`catalog_pick`). |
| 🧠 | **On-Demand Advisor (`/advisor`)** | Expensive flagship models stay asleep until you call them. When facing tough architectural decisions or tricky bugs, bind an advisor to get short, actionable guidance. |
| 🧗 | **Ponytail YAGNI Ladder** | Built-in system prompt discipline: models climb a strict ladder (YAGNI → reuse existing code → stdlib → platform feature → dependency → 1 line → minimal code). |
| 🗺️ | **Repo-Map Auto-Injector** | Reads `.codegraph` SQLite indexes and injects a high-level summary of key files and symbols on turn 1, preventing costly exploratory file searches. |
| 🔗 | **Hash-Anchored Edits (Hashline)** | Every line read by the agent is tagged with a content hash (`LINE#ID`). Edits are verified against these hashes before saving, eliminating broken diffs and stale-line bugs. |
| 🛠️ | **LSP & AST-Grep Integration** | Built-in language servers provide diagnostics, jump-to-definition, reference lookups, and AST-aware search across 25+ programming languages. |
| 👥 | **Parallel Background Subagents** | Runs multiple subagents concurrently (`task(subagent_type=..., run_in_background=true)`) so long-running research or tests don't block the conversation. |
| 📐 | **Rules Engine & `AGENTS.md`** | Auto-loads project conventions, coding rules, and directory-specific `AGENTS.md` files into agent context automatically. |
| 🎯 | **Goal & Todo Enforcer** | Tracks persistent session objectives (`/goal`) and automatically re-engages the agent if it stops before all tasks are finished. |
| 💬 | **Comment Checker** | Strips out verbose AI filler and repetitive boilerplate comments, ensuring generated code looks like it was written by a human senior developer. |

---

## 🤖 The Agent Roster & Delegation

momo uses an efficient, simplified agent roster. Heavy legacy agents are kept in the codebase for reference, but disabled by default so your environment stays lightweight:

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
│  & File Search   │      │  & OSS Research  │      │  Architecture    │
└──────────────────┘      └──────────────────┘      └──────────────────┘
```

### 1. momo Orchestrator (Primary Agent)
- **Role:** Project Lead / Dispatcher.
- **Behavior:** Reads user goals, analyzes the repo map, writes task checklists, and delegates implementation to subagents.
- **Model:** Zero-config — automatically inherits whatever model you selected in OpenCode (`/models`).

### 2. explore (Codebase Specialist)
- **Role:** Fast contextual search inside your local repository.
- **Trigger:** Finding function definitions, tracing variable usages, locating files.

### 3. librarian (External Research Specialist)
- **Role:** External documentation, library API lookups, and web searches.
- **Trigger:** Researching unfamiliar dependencies or third-party documentation.

### 4. advisor (On-Demand Senior Architect)
- **Role:** High-level problem solving and architectural review.
- **Trigger:** Activated only when bound via `/advisor <model>`. Receives a compact problem summary (<300 tokens) and returns short, decisive advice.

### Task Execution Categories
When the orchestrator delegates tasks, it maps requirements to execution categories:
- **`quick`:** Small single-file fixes, typos, and minor adjustments (uses fast, low-cost flash-tier models).
- **`deep`:** Multi-file features, refactoring, and research-heavy tasks.
- **`visual-engineering`:** Frontend UI/UX, CSS, and layout design.
- **`ultrabrain`:** Complex algorithms, performance optimization, and deep logical problems.

---

## 📦 Prerequisites

Before installing momo, ensure your machine has:

1. **[Bun](https://bun.sh/)** (version 1.1 or higher)  
   *Note: momo uses Bun for building and running. Do not run npm, yarn, or pnpm in the root directory.*
2. **[OpenCode CLI](https://opencode.ai/)** installed and accessible in your terminal (`opencode`).
3. *(Optional)* **[Ollama](https://ollama.com/)** for local prompt translation.  
   *(If not installed, momo will automatically download and configure Ollama and `qwen2.5:1.5b` on Linux/macOS on first run).*

---

## 🚀 Quick Start & Installation

### Step 1: Clone the Repository
```bash
git clone https://github.com/furkanbora239/omo.git
cd omo
```

### Step 2: Install Dependencies
```bash
bun install
```

### Step 3: Build the Plugin Bundle
```bash
bun run build
```
*This bundles TypeScript sources, builds MCP servers, and prepares the `./dist` folder.*

### Step 4: Register momo with OpenCode
```bash
opencode plugin . --force
```

### Step 5: Start OpenCode
```bash
opencode
```
- Type `/models` inside OpenCode to choose your main model.
- That model immediately becomes your **orchestrator** with zero extra configuration.

---

## ⚙️ Full Configuration Guide (`omo.jsonc`)

momo works out of the box with sensible defaults. You can customize any behavior by editing `~/.omo/omo.jsonc` (or `.opencode/oh-my-openagent.jsonc` for project-level settings):

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/furkanbora239/omo/dev/assets/oh-my-opencode.schema.json",

  // 1. Local Prompt Translator (Ollama)
  "local_translator": {
    "enabled": true,                 // Enable local prompt translation & compression
    "model": "qwen2.5:1.5b",          // Local Ollama model tag
    "ollama_host": "http://localhost:11434",
    "timeout_ms": 30000,
    "auto_install": true,            // Automatically install Ollama if missing
    "min_length": 20,                // Do not translate messages shorter than 20 characters
    "log_translations": true         // Log inputs/outputs to ~/.omo/local-translator-logs/
  },

  // 2. Model Catalog MCP
  "catalog": {
    "enabled": true                  // Real-time dynamic model picker
  },

  // 3. Advisor Agent Binding (Optional default)
  "agents": {
    "advisor": {
      "model": "openrouter/anthropic/claude-3.7-sonnet"
    }
  },

  // 4. Category Model Overrides (Optional)
  "categories": {
    "quick": {
      "model": "google/gemini-2.5-flash"
    },
    "deep": {
      "model": "deepseek/deepseek-chat"
    }
  },

  // 5. Disabled Hooks (Optional optimization)
  "disabled_hooks": [
    // "todoDescriptionOverride"
  ]
}
```

---

## 💬 Slash Commands & Daily Usage

| Command | Usage & Description |
| :--- | :--- |
| `/models` | Select your primary model inside OpenCode (automatically sets the orchestrator). |
| `/advisor <model>` | Bind an advisor model for the current session (e.g. `/advisor openrouter/anthropic/claude-3.7-sonnet`). |
| `/advisor off` | Unbind the advisor when no longer needed. |
| `/goal <objective>` | Set a persistent goal for the session; agent will work until completion criteria are met. |
| `/init-deep` | Scan your project and automatically create structured `AGENTS.md` documentation files. |
| `omo doctor` | Run health and configuration diagnostics on providers, models, catalog MCP, and plugins. |

---

## 🛠️ Developer & Contributor Guide

If you are developing or contributing to momo, keep the following workflow in mind:

### Essential Commands
```bash
# Check types across all packages (uses tsgo, not tsc)
bun run typecheck

# Run OpenCode plugin unit tests
bun test packages/omo-opencode/src

# Run the complete workspace test suite
bun test

# Rebuild distribution bundles
bun run build

# Regenerate configuration JSON schema
bun run build:schema
```

### Contributor & AI Agent Rules
- **No catch-all files:** Never create `utils.ts`, `helpers.ts`, or `service.ts`. Keep files modular and focused (~200 lines soft limit).
- **Factory pattern:** Always export factory functions like `createXXX()` for tools, hooks, and agents.
- **Cross-runtime shims:** Never call raw `Bun.spawn` directly in production plugin files; always use `packages/omo-opencode/src/shared/bun-spawn-shim.ts`.
- **Testing convention:** Write tests with `bun:test` using `given / when / then` blocks. Never write tests that assert exact system prompt text.

---

## 📂 Codebase Layout

```
omo/
├── packages/
│   ├── omo-opencode/        # Main OpenCode plugin distribution (momo's core focus)
│   │   └── src/
│   │       ├── agents/      # Orchestrator, Advisor, and dynamic prompt builders
│   │       ├── config/      # Zod configuration schemas & validation
│   │       ├── features/    # Features: local-translator, repo-map, etc.
│   │       ├── mcp/         # Built-in MCP servers (catalog MCP, ast-grep, lsp)
│   │       ├── shared/      # Cross-runtime shims, logger, and audit tests
│   │       └── tools/       # Tools (delegate-task, background-manager, hashline)
│   ├── model-core/          # Model resolution, aliases, and capability matrices
│   ├── delegate-core/       # Category-to-model delegation logic
│   ├── prompts-core/        # Shared system prompt components & Ponytail ladder
│   ├── rules-engine/        # AGENTS.md parsing & context injector
│   ├── hashline-core/       # Hash-anchored line editing engine
│   └── lsp-core/            # Language Server Protocol client & daemon
├── .agents/skills/          # Project skills and workflows
├── plan.md                  # Project plan and phase tracker
└── LICENSE.md               # SUL-1.0 License terms
```

---

## 📜 License & Attribution

- **Original Project:** [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) by YeonGyu Kim and contributors.
- **License:** Distributed under the **[Sustainable Use License 1.0 (SUL-1.0)](./LICENSE.md)**.
  - **Free for personal, non-commercial, and educational use and redistribution.**
  - Commercial use requires upstream licensing.
  - Relicensing (such as under MIT or Apache) is strictly prohibited.
  - All original copyright notices and the modification notice must be preserved.

