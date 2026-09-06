# momo — Complete Usage Guide & Command Reference

This document provides a comprehensive, in-depth guide on how **momo** (My Oh My Openagent) works, its architecture, slash commands, agent roles, configuration options, and internal mechanisms.

---

## 📑 Table of Contents

1. [Architecture & Core Concepts](#1-architecture--core-concepts)
2. [Quick Start & Installation](#2-quick-start--installation)
3. [Complete Slash Commands Reference](#3-complete-slash-commands-reference)
   - [`/momo` & `/help` — Interactive Guide](#momo--help--interactive-guide)
   - [`/caveman` — Prompt Translator & Token Compressor](#caveman--prompt-translator--token-compressor)
   - [`/advisor` — On-Demand Senior Advisor](#advisor--on-demand-senior-advisor)
   - [`/goal` — Autonomous Execution Loop](#goal--autonomous-execution-loop)
   - [`/handoff` — Context Summary & Session Transfer](#handoff--context-summary--session-transfer)
   - [`/stop-continuation` — Stop Active Loops](#stop-continuation--stop-active-loops)
   - [`/remove-deadcode` — Dead Code Cleanup](#remove-deadcode--dead-code-cleanup)
   - [`/tech-debt-audit` — Technical Debt Audit](#tech-debt-audit--technical-debt-audit)
4. [Agent System & Delegation Categories](#4-agent-system--delegation-categories)
5. [CLI Tool Commands (`oh-my-opencode` / `omo`)](#5-cli-tool-commands-oh-my-opencode--omo)
6. [Configuration Reference (`~/.omo/omo.jsonc`)](#6-configuration-reference-omoomojsonc)
7. [Advanced Technologies & Internals](#7-advanced-technologies--internals)
8. [Troubleshooting & FAQ](#8-troubleshooting--faq)

---

## 1. Architecture & Core Concepts

Standard AI coding harnesses send massive context windows and entire project trees to expensive frontier models on every turn. 

**momo's North Star:**
> A lightweight, cost-effective **Orchestrator** acts as a technical lead: it plans, investigates, and delegates tasks to cheaper specialized subagents via the Live Catalog MCP. User prompts are compressed locally using Ollama (`qwen2.5:1.5b`), and frontier models act strictly as bound-on-demand advisors.

```
                      ┌────────────────────────────────────────┐
                      │    User Prompt (Any Language / Text)   │
                      └───────────────────┬────────────────────┘
                                          │
                                          ▼
                      ┌────────────────────────────────────────┐
                      │    Local Translator (Ollama / Qwen)    │
                      │    -> Translates to EN & Compresses    │
                      └───────────────────┬────────────────────┘
                                          │
                                          ▼
                      ┌────────────────────────────────────────┐
                      │    Main Orchestrator (Sisyphus)        │
                      │    - Reads Repo-Map & builds plan      │
                      │    - Delegates tasks to subagents      │
                      └───────┬────────────────────────┬───────┘
                              │                        │
       [Routine Subtasks]     │                        │  [Complex Stuck Bugs]
                              ▼                        ▼
     ┌─────────────────────────────────┐      ┌────────────────────────┐
     │   Live Model Catalog MCP        │      │   On-Demand Advisor    │
     │   (`catalog_pick`)              │      │   (Opus 5 / Sol 5.6)   │
     │   -> quick, deep, visual, etc.  │      │   via `/advisor`       │
     └─────────────────────────────────┘      └────────────────────────┘
```

---

## 2. Quick Start & Installation

### Step 1: Clone and Install
```bash
git clone https://github.com/furkanbora239/momo.git
cd momo
bun install
```

### Step 2: Build Plugin
```bash
bun run build
```

### Step 3: Add to OpenCode Configuration
In `~/.config/opencode/opencode.json` (or project `opencode.json`):
```json
{
  "plugin": [
    "/absolute/path/to/momo"
  ]
}
```

### Step 4: Launch OpenCode
```bash
opencode
```
1. Type `/models` inside OpenCode and pick your favorite model.
2. It automatically becomes the **momo Orchestrator** with zero extra setup.

---

## 3. Complete Slash Commands Reference

### `/momo` — Interactive Guide
- **Purpose:** Displays interactive help and comprehensive command descriptions directly inside the chat session. Responds in Turkish if queried in Turkish, English otherwise.
  *(Note: OpenCode's native `/help` command shows the client command list without sending a prompt to chat).*
- **Usage:**
  ```text
  /momo               # Shows the full command & feature index
  /momo caveman       # Deep dive into /caveman prompt translator
  /momo advisor       # Deep dive into /advisor binding
  /momo goal          # Deep dive into /goal autonomous loop
  /momo planner       # Explains the dedicated planner agent
  /momo worker        # Explains the direct execution worker agent
  /momo config        # Configuration guidance (~/.omo/omo.jsonc)
  ```

---

### `/caveman` (Aliases: `/cavemen`, `/c`) — Prompt Translator & Token Compressor
- **Purpose:** Translates user prompt (e.g. from Turkish) into concise, high-density Caveman English before reaching the main LLM. Cuts input tokens by 30-50%.
- **Modes:**
  - `trigger: "command"` (default): Only translates when prompt starts with `/caveman <prompt>`, `/cavemen <prompt>`, or `/c <prompt>`.
  - `trigger: "always"`: Translates all prompts automatically.
  - `mode: "cloud"` (default): Free Google Gemma via Gemini API (zero local resource load).
  - `mode: "local"`: Local Ollama model (`qwen2.5:1.5b` or `gemma3:1b`).
- **Usage:**
  ```text
  /caveman bu dosyadaki bellek sızıntısını bul ve düzelt
  /c optimize SQL queries in user service
  ```

---

### `/advisor` — On-Demand Senior Advisor
- **Purpose:** Binds a flagship frontier model (e.g. Claude Opus 5, Kimi K3, GPT-5.6 Sol) for architectural decisions or debugging tough issues. Unbound by default to prevent unexpected API costs.
- **Usage:**
  ```text
  /advisor neuralwatt/kimi-k3          # Bind advisor for current session
  /advisor report                      # Check current binding status
  /advisor off                         # Unbind advisor
  ```
- **Persistent Alternative:** Configure `agents.advisor.model` in `~/.omo/omo.jsonc`.

---

### `/goal` — Autonomous Execution Loop
- **Purpose:** Sets a persistent objective. The orchestrator and subagents continuously work through tasks until all criteria and verification tests pass.
- **Usage:**
  ```text
  /goal Migrate database queries to Prisma and ensure test suite passes
  /goal pause     # Pause active goal loop
  /goal resume    # Resume paused goal
  /goal clear     # Clear active goal
  ```

---

### `/handoff` — Context Summary & Session Transfer
- **Purpose:** When session context gets too long, generates a clean, self-contained summary to resume seamlessly in a new session.
- **Usage:**
  ```text
  /handoff
  /handoff "Continue with frontend integration in the next session"
  ```

---

### `/stop-continuation` — Stop Active Loops
- **Purpose:** Immediately aborts all continuation mechanisms (goal loops, todo continuation, background tasks) and brings the agent to idle.
- **Usage:**
  ```text
  /stop-continuation
  ```

---

### Project & Skill Commands:
- `/remove-deadcode`: LSP-verified dead code removal across the project.
- `/tech-debt-audit`: Comprehensive 9-dimension technical debt audit across the repository.

---

## 4. Agent System & Delegation Categories

| Agent | Role | Usage |
| :--- | :--- | :--- |
| **momo Orchestrator (`sisyphus`)** | Lead Architect / Coordinator | Plans, analyzes repo-map, delegates subtasks. Inherits model from `/models`. |
| **`planner`** | Dedicated Strategic Planner | Tab-switchable (`mode: "all"`). Read-only architectural and execution planning. |
| **`worker` (`sisyphus-junior`)** | Direct Execution Agent | Tab-switchable (`mode: "all"`). Edits single files, runs tests, commits without orchestrator overhead. |
| **`explore`** | Codebase Search Specialist | Fast contextual grep, symbol lookups, and reference tracing. |
| **`librarian`** | External Research Specialist | Online documentation, library APIs, and web search. |
| **`advisor`** | On-Demand Senior Advisor | Consulted only when bound via `/advisor`. Returns short, high-value directives. |

### Delegation Categories (`task(category=...)`):
- **`quick`:** Single-file edits, typos, small fixes (flash-tier models).
- **`deep`:** Multi-file features, architecture changes, and major implementations.
- **`visual-engineering`:** Frontend UI/UX, CSS styling, and responsive layout.
- **`ultrabrain`:** Difficult algorithms, performance tuning, and complex logic.

---

## 5. CLI Tool Commands (`oh-my-opencode` / `omo`)

```bash
# Diagnostic & Health Check
bunx oh-my-opencode doctor
bunx oh-my-opencode doctor --status
bunx oh-my-opencode doctor --verbose

# Interactive Setup
bunx oh-my-opencode install

# Task-Enforced Run
bunx oh-my-opencode run "Fix flaky tests in auth module"

# Configuration Migration
bunx oh-my-opencode config migrate
```

---

## 6. Configuration Reference (`~/.omo/omo.jsonc`)

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/furkanbora239/momo/dev/assets/oh-my-opencode.schema.json",

  // 1. Local Prompt Translator (Ollama)
  "local_translator": {
    "enabled": true,
    "trigger": "command",            // "command" = only on /caveman or /c (default), "always" = all messages
    "model": "qwen2.5:1.5b",
    "ollama_host": "http://localhost:11434",
    "timeout_ms": 30000,
    "auto_install": true,
    "min_length": 20
  },

  // 2. Model Catalog MCP
  "catalog": {
    "enabled": true
  },

  // 3. Persistent Advisor Model (Optional)
  "agents": {
    "advisor": {
      "model": "anthropic/claude-opus-5"
    }
  },

  // 4. Subagent Category Overrides
  "categories": {
    "quick": { "model": "google/gemini-3-flash" },
    "deep": { "model": "opencode-go/glm-5.3-flash" },
    "ultrabrain": { "model": "openai/gpt-5.6-sol" }
  }
}
```

---

## 7. Advanced Technologies & Internals

1. **Local Prompt Compression (Ollama):** Translates prompts to English and compresses verbose descriptions locally using `qwen2.5:1.5b` before sending requests to cloud providers, cutting token consumption significantly.
2. **Live Catalog MCP (`catalog_pick`):** Queries active providers and dynamically matches the cheapest capable model for subtasks without extra LLM overhead.
3. **Hashline Editing:** Protects file edits using line-anchored hashes (`LINE#HASH`), preventing hallucinated line drifts or corrupted files.
4. **Repo-Map Auto-Injector:** Automatically generates and injects a high-level summary of key project symbols on turn 1.

---

## 8. Troubleshooting & FAQ

- **Advisor Unbound:** Run `/advisor <model-id>` or configure `agents.advisor.model` in `~/.omo/omo.jsonc`.
- **Ollama Issues:** Ensure `ollama serve` is running and `ollama pull qwen2.5:1.5b` is installed.
- **Diagnostic Inspection:** Run `bunx oh-my-opencode doctor --verbose` to inspect plugin status, providers, and environment.
