# DeepSeek Harness (dsh) — tracking note

> Tracked for periodic review as a possible source of ideas / integration points
> for this DeepSeek-optimized fork.

## What it is

DeepSeek Harness (`dsh`) is DeepSeek AI's official open-source agent harness,
released as a **developer preview** on 2026-08-13 (same day as DeepSeek-V4-Pro GA).

- Repo: https://github.com/deepseek-ai/deepseek-harness
- Site: https://deepseek.com/harness
- License: **MIT**
- Launch: `npx @deepseek-ai/dsh web`
- Built on **Cordis** (https://github.com/cordiverse/cordis)

## Core idea

"Everything is a plugin." Models, tools, skills, sessions, sandboxes, filesystems,
loops, orchestration and the UI are all plugins, composable/swapable via config.
There is no privileged core to patch.

## Presets

- **Standard** — full coding agent: filesystem, shell, web search, subagents, plan mode
- **Minimal** — only `bash` + `str_replace_editor`
- **Code** — generates a TypeScript SDK; the model writes one program instead of N round trips
- **Creator** — Standard + runtime inspection, plugin experiments, preset authoring

## Notable architecture

- Append-only session log (resume / fork / replay / transcripts / telemetry / web UI all read the same event stream)
- Sandboxing via Linux Landlock (Node addon), macOS Seatbelt, Windows ACL restricted token
- MCP client + Agent Client Protocol + AGENTS.md / CLAUDE.md support
- Subagent providers that delegate to Claude Code / Codex (both off by default)
- Chain-of-thought traces
- Provider catalog: Anthropic, OpenAI, AWS Bedrock, Azure, Gemini, DeepSeek, + custom OpenAI-compatible gateways

## Caveats

- Developer preview, **compatibility-breaking changes expected**
- **No external PRs accepted yet** (build plugins / use Discussions instead)

## Why we track it

1. DeepSeek-native tool-calling / reasoning semantics (V4-Pro / V4-Flash thinking mode)
   — useful reference for our `sisyphus/deepseek.ts` prompt variant.
2. Plugin composition + append-only event stream are ideas worth borrowing.
3. Possible future alternative runtime base if upstream omo drifts too far.

## Last checked

2026-08-20
