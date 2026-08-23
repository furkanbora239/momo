# omo — My Oh My Openagent

> **MODIFIED SOFTWARE NOTICE** — This repository is a fork of
> [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent)
> ("oh-my-opencode" / "oh-my-openagent" upstream) and has been substantially
> modified. It is distributed under the same
> [Sustainable Use License 1.0](./LICENSE.md) (SUL-1.0, **not** OSI open source).
> The original upstream README is preserved at
> [README.upstream.md](./README.upstream.md).

A token-efficient, **cheap-provider-first** fork of the OmO agent harness for
OpenCode. Optimized defaults for `opencode-go` + `neuralwatt`; any number of
providers supported.

## Why this fork exists

The upstream project is tuned for a handful of flagship models: 11 agents,
54+ lifecycle hooks, always-on MCPs, and per-model orchestrator prompts. That
shape over-delegates reasoning to expensive models and burns output tokens.

This fork reorients the harness around a single idea:

> **A cheap orchestrator that plans, delegates aggressively to cheaper
> subagents, picks subagent models at runtime from a live catalog, and emits as
> few output tokens as possible. Big models act as bound-on-demand advisors,
> never default executors.**

Provider-agnostic by design. There is no pinned "target model" — the opencode
`/models` selection is the main model, and subagents are chosen per task from
whatever providers you actually have connected.

## North star

- **Delegation over implementation** — the orchestrator is a director, not a coder.
- **Cheapest adequate model** — subagent models are chosen per task from a live
  catalog (cost, context window, modality aware).
- **Token discipline** — minimal orchestrator output, pruned hooks, MCPs on
  demand, telemetry off by default.
- **Zero config to start** — install, pick a model via `/models`, go. Power users
  can override everything in `~/.omo/omo.jsonc`.
- **No surprises** — expensive models are never auto-selected; you bind them on
  demand.

## Status

Early work-in-progress. Not affiliated with the upstream project. Licensed
SUL-1.0 (not OSI open source); the upstream license and this MODIFIED notice are
preserved.

## Fork work (so far)

The fork's goals and phased plan live in [`plan.md`](./plan.md); engineering and
agent conventions in [`AGENTS.md`](./AGENTS.md).

- [x] momo identity, `README.md` / `AGENTS.md` rewrite (provider-agnostic, SUL-1.0
  + MODIFIED notice preserved).
- [ ] Model Catalog MCP (`catalog`) — built-in Tier-1, live provider models +
  `catalog_list` / `catalog_pick` / `catalog_refresh`.
- [ ] Zero-config main model — orchestrator inherits the opencode session model.
- [ ] Advisor role — big model on demand, unbound by default.
- [ ] Simplified agent topology (Phase A roster: orchestrator + explore/librarian
  + task categories + advisor).
- [ ] Token-burn pruning — default-off heavy chat-injection hooks.

## Notes

- [DeepSeek Harness (dsh) reference note](./notes/deepseek-harness.md) — retained
  as a provider reference; momo is provider-agnostic, not DeepSeek-specific.

## Upstream

- Repository: <https://github.com/code-yeongyu/oh-my-openagent>
- Original README: [README.upstream.md](./README.upstream.md)

## License

Original code © code-yeongyu and contributors, licensed under the
[Sustainable Use License 1.0](./LICENSE.md). This fork is distributed under the
same license. Free non-commercial use and redistribution only; you may not
relicense (e.g. to MIT). You may use and modify it for non-commercial / personal
purposes and redistribute it free of charge, provided you keep all notices and
this modification statement.
