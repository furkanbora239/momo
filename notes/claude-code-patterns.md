# Claude Code Patterns Reference

Research date: 2026-09-02. Primary sources unless marked [Community]. Basis for tool-description and roster optimization waves.

## 1. Tool Description Patterns

Source: Claude Code tool YAML (hqman gist, Sep 2025); Anthropic eng blog "Writing effective tools for agents" (Sep 11, 2025).

Observed structure per tool (~50-150 words): one-line purpose, then "Usage notes:" bullet list.

- One-line purpose first. Example (Bash): "Executes a given bash command in a persistent shell session with optional timeout."
- "Usage notes:" bullets for constraints, not prose. Bash: 8 bullets (timeout, truncation, forbidden commands, quoting).
- When-to-use / When-NOT-to-use only for the delegation tool (Task). Example: "If you want to read a specific file path, use Read or Glob instead of the Agent tool."
- Parallel-call enforcement lives in the system prompt once, not per tool.
- Tool-result cap 25,000 tokens default; truncation notice steers narrower queries.
- Few thoughtful tools for high-impact workflows, not wrappers per API endpoint. Consolidate chained operations into one tool.
- Return high-signal fields (name, image_url), not low-level IDs.
- Expose response_format: "concise" | "detailed" enum where relevant (~1/3 token savings per Anthropic's Slack example).
- Prompt-engineer error responses to be actionable.

## 2. Subagent (Task/Agent) Design

Source: code.claude.com/docs/en/sub-agents; Agent SDK subagents docs; leaked system prompt.

- Stateless by default. "Each agent invocation is stateless."
- Description is the routing signal: keep short; total description budget 15,000-token warning in Claude Code.
- Context isolation is the point: subagent gets own system prompt + task string + project CLAUDE.md + tool defs. Never parent history/results/system prompt.
- Built-in roster tiny: Explore (read-only fast), Plan (read-only), general-purpose, claude-code-guide (Haiku, narrow scope). Explore/Plan skip CLAUDE.md and git status to stay cheap.
- Tool restriction is the primary knob (Explore/Plan deny Write/Edit/Agent).
- Model routing layered: per-invocation model > frontmatter model > env > parent model; inherit first-class.
- Return contract: single final message; detailed search context never re-enters parent window; lead gets 1-2K token summary.

## 3. Extensions / Slash Commands Surface

Source: code.claude.com/docs/en/sub-agents, /plugins; system prompt leak.

- Skills = slash commands. System prompt lists only user-invocable skills; "only use skills listed, don't guess."
- Subagents are model-delegated via Agent tool, not slash-invoked.
- Registration filesystem-based: .claude/agents/*.md (YAML frontmatter + markdown body), hot-reload, project + user scopes.
- Built-in command surface small: /help, /model, /statusline, /agents, /doctor, /compact, /resume + permission-mode commands. Domain stuff is a skill, loaded on demand.
- MEMORY.md index truncated after 200 lines.

## 4. System Prompt Structure & Size

Source: asgeirtj/system_prompts_leaks claude-code-sonnet-5.md (2888 lines / 167 KB, CC0-1.0 archive); Anthropic "Effective context engineering for AI agents" (Sep 29, 2025).

Section order: identity, safety, system mechanics, doing tasks, executing actions with care, using tools (parallel calls), tone and style, text output (one-sentence pre-tool announcement, 1-2 sentence end summary), session guidance, memory, environment, context management, git status, agents roster, skills roster.

Anthropic principles:

- "Right altitude": specific enough to guide, flexible enough to be heuristics. Not brittle if-else, not vague.
- "Smallest possible set of high-signal tokens that maximize the likelihood of your desired outcome."
- Organize with section markers (XML tags / Markdown headers); stable ordering helps prompt caching.
- Context rot: recall degrades as token count grows. Treat context as finite with diminishing returns.
- Hybrid retrieval: rules up front; glob/grep just-in-time.
- Compaction ladder: clear tool results first (safest, lightest), then summarize, then sub-agent handoff.

## Adoptable Rules for momo

1. Tool descriptions: one-liner + "Usage notes:" bullets, cap ~100 words, no prose.
2. Parallel-call rule once in system prompt, never per tool.
3. When-to-use / When-NOT-to-use only for delegation tools.
4. Subagent description <= 1 sentence routing signal; total description budget momo target ~3K tokens.
5. Subagent context isolation non-negotiable: own prompt + task string + project rules + tool subset, never parent history.
6. Built-in subagent roster <= 5; everything else user-defined skill.
7. Tool-result cap lower than Claude Code for cheap models (8-12K) + truncation notice.
8. response_format concise/detailed on read-heavy tools.
9. Fixed system-prompt section order for cache stability.
10. "Right altitude" test: if the harness can enforce it (schema/permission/tool restriction), do not put it in the prompt.
11. Slash commands and subagents are separate rosters; keep always-loaded entries under ~10 each.
12. Compaction is the first lever: clear tool results, then summarize, then hand off; parent context is not a dumping ground.

## Source Index

- S1 https://www.anthropic.com/engineering/writing-tools-for-agents (Primary)
- S2 https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents (Primary)
- S3 https://github.com/asgeirtj/system_prompts_leaks/blob/main/Anthropic/claude-code/claude-code-sonnet-5.md (Primary leak, CC0-1.0)
- S4 https://gist.github.com/hqman/f9d59c25a68666f019c1c084c8347245 (Primary leak)
- S5 https://code.claude.com/docs/en/sub-agents (Primary docs)
- S6 https://code.claude.com/docs/en/agent-sdk/subagents (Primary docs)
- S7 https://inference.net/content/claude-agent-sdk-production-guide/ (Secondary, verified against S5/S6)
- S8 https://explainx.ai/blog/claude-fable-5-system-prompt-leak-analysis-2026 (Community)
- S9 https://github.com/ThamJiaHe/claude-code-handbook (Community)
