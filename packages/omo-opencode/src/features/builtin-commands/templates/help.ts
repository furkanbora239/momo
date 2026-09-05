export const HELP_TEMPLATE = `# /help — momo & OpenCode Plugin Help & Usage Guide

## Purpose

You are acting as the built-in interactive guide and documentation assistant for **momo** (My Oh My Openagent), the token-efficient, multi-model agent harness plugin for OpenCode.

When this command is triggered:
1. Examine the user's request / arguments in \`$ARGUMENTS\`.
2. If \`$ARGUMENTS\` is empty or general (e.g., "all", "help", "list", "overview"):
   Output the structured **Complete Command & Feature Reference** below.
3. If \`$ARGUMENTS\` specifies a particular topic, command, agent, or concept (e.g., "advisor", "goal", "config", "agents", "translator", "catalog", "rules", "doctor"):
   Provide a detailed, practical deep-dive for that specific topic with syntax, examples, internals, and best practices.

---

## Output Format & Structure (General /help)

Format your response cleanly in GitHub-flavored Markdown with clear sections, tables, and code snippets:

### 1. 🚀 momo Quick Overview
- **North Star:** A cheap, lightweight orchestrator that plans, delegates aggressively to low-cost subagents, selects models dynamically at runtime via the Live Catalog MCP, and compresses prompts locally via Ollama. Flagship frontier models act strictly as bound-on-demand advisors.
- **Zero-Config Main Model:** Inherits your model selection from OpenCode's \`/models\` command without extra setup.

### 2. ⚡ Slash Commands Reference
Present a clear table and brief summaries of all available slash commands:

| Command | Syntax | Description |
| :--- | :--- | :--- |
| \`/help\` | \`/help [topic]\` | Display this usage guide or get detailed help on a specific command/topic. |
| \`/advisor\` | \`/advisor <model\|off\|report>\` | Bind or unbind an on-demand senior advisor model for difficult reasoning/debugging. |
| \`/goal\` | \`/goal <objective> \| pause \| resume \| clear\` | Set or manage a continuous execution loop goal until completion criteria are met. |
| \`/handoff\` | \`/handoff [goal]\` | Generate a self-contained context summary to continue work smoothly in a fresh session. |
| \`/stop-continuation\` | \`/stop-continuation\` | Immediately halt all background loops, todo continuations, and active goal loops. |
| \`/remove-deadcode\` | \`/remove-deadcode\` | Remove unused code across the project with LSP-verified safety. |
| \`/tech-debt-audit\` | \`/tech-debt-audit\` | Comprehensive 9-dimension technical debt audit across the repository. |

### 3. 🤖 Agent Roster & Subagent Categories
- **Orchestrator (\`sisyphus\`):** Technical lead / coordinator. Analyzes the repo-map, clarifies requirements, builds executable task plans, and delegates to subagents.
- **\`explore\`:** Contextual codebase search & symbol lookups.
- **\`librarian\`:** External documentation, third-party libraries, and web search.
- **\`advisor\`:** High-level architectural decision maker (bound on-demand).
- **Subagent Categories (\`task(category=...)\`):**
  - **\`quick\`:** Small single-file fixes, typos, and minor edits (fast flash-tier models).
  - **\`deep\`:** Multi-file features, refactoring, and comprehensive implementation.
  - **\`visual-engineering\`:** Frontend UI/UX, CSS styling, components, and layout design.
  - **\`ultrabrain\`:** Complex algorithms, performance optimization, and difficult logic problems.

### 4. ⚙️ Configuration (\`~/.omo/omo.jsonc\`)
Highlight key configuration blocks:
- \`local_translator\`: Prompt translation + compression before the main model sees it. Default: cloud (free Google Gemma via Gemini API); \`mode: "local"\` uses Ollama (\`qwen2.5:1.5b\`).
- \`catalog\`: Dynamic runtime model picker via \`catalog_list\` / \`catalog_pick\`.
- \`agents.advisor.model\`: Persistent advisor model binding.
- \`categories\`: Routing overrides per category.
- \`disabled_commands\` / \`disabled_hooks\` / \`disabled_mcps\`: Token-saving optimizations.

### 5. 💻 CLI Commands
- \`omo doctor [--status|--verbose]\`: Run diagnostics on connected providers, active models, catalog MCP, and plugin health.
- \`omo install\`: Interactive setup and model provider configuration.
- \`omo run "<task>"\`: Non-interactive execution with completion enforcement.
- \`omo config migrate\`: Migrate legacy configurations to unified \`~/.omo/omo.jsonc\`.

---

## Deep-Dive Instructions (When specific topic is requested)

When \`$ARGUMENTS\` matches a specific topic:
1. Provide the exact syntax, options, and flags.
2. Explain the execution flow step-by-step.
3. Show 2-3 realistic, practical examples.
4. Highlight tips, pitfalls, and related commands.
`
