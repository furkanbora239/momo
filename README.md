# omo — DeepSeek-optimized fork

> **MODIFIED SOFTWARE NOTICE** — This repository is a fork of
> [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
> and has been substantially modified. It is distributed under the same
> [Sustainable Use License 1.0](./LICENSE.md). The original upstream README is
> preserved at [README.upstream.md](./README.upstream.md).

A DeepSeek-first, cost-optimized fork of the OmO agent harness for OpenCode.

## Why this fork exists

The upstream project is tuned for Claude Opus / Kimi K3 / GPT-5.6: 11 agents,
54+ lifecycle hooks, always-on MCPs, and per-model orchestrator prompts for
every model **except** DeepSeek. DeepSeek silently falls through to the
Claude-tuned default, which is why it under-delegates, does work itself, and
burns expensive output tokens.

This fork reorients the harness around a single idea:

> **a cheap orchestrator that plans, delegates aggressively to even cheaper
> subagents, and emits as few output tokens as possible.**

## Goals

- **DeepSeek-native** — first-class prompt variants for DeepSeek V4 (Pro/Flash)
  that match its tool-calling and reasoning style instead of the Claude fallback.
- **Cheaper** — the orchestrator acts as a director, not an implementer. Work is
  delegated to category-mapped low-cost subagents (e.g. `deepseek-v4-flash`).
- **Less token burn** — minimal orchestrator output, pruned hooks, MCPs on
  demand, telemetry removed.
- **Plan → review → approve** — the orchestrator can invoke a planner, review the
  plan, and approve before execution.

## Status

Early work-in-progress. Not affiliated with the upstream project.

## Fork changes (so far)

- [ ] DeepSeek orchestrator prompt variant (`sisyphus/deepseek.ts` + factory registration)
- [ ] DeepSeek variants for ultrawork / prometheus / atlas prompts
- [ ] Delegation routing tuned for cheap DeepSeek subagents
- [ ] Plan → review → approve orchestration flow
- [ ] Prune unused hooks/MCPs, remove telemetry

## Notes

- [DeepSeek Harness (dsh) tracking note](./notes/deepseek-harness.md)

## Upstream

- Repository: <https://github.com/code-yeongyu/oh-my-openagent>
- Original README: [README.upstream.md](./README.upstream.md)

## License

Original code © code-yeongyu and contributors, licensed under the
[Sustainable Use License 1.0](./LICENSE.md). This fork is distributed under the
same license. You may use and modify it for non-commercial / personal purposes
and redistribute it free of charge, provided you keep all notices and this
modification statement.
