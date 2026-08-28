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
- [x] Model Catalog MCP (`catalog`) — built-in Tier-1, live provider models +
  `catalog_list` / `catalog_pick` / `catalog_refresh`.
- [x] Zero-config main model — orchestrator inherits the opencode session model.
- [x] Advisor role — big model on demand, unbound by default (delegation-gated).
- [x] Simplified agent topology (Phase A roster: orchestrator + explore/librarian
  + task categories + advisor; legacy agents disabled by default, code kept).
- [x] Token-burn pruning — default-off heavy chat-injection hooks.
- [x] Repo-map auto-injector — Aider-style compressed codebase map from the
  `.codegraph` index, injected once per session into the first user message
  (`config.repo_map.enabled: true`; recommended on when `.codegraph` exists,
  default off).

## Setup

Any number of providers; the defaults assume `opencode-go` + `neuralwatt`, the
cheap end of the spectrum. `google` is a common third (vision models).

1. Install the plugin and register it with opencode (per upstream install flow).
2. Connect providers in opencode (auth for `opencode-go`, `neuralwatt`, or any
   API you have). The catalog MCP lists whatever is connected, per session.
3. Start a session and pick the main model with opencode `/models` — that model
   IS the orchestrator. No other config is required.

`bunx oh-my-opencode doctor` reports the active roster, catalog state, advisor
binding, and repo-map state.

## Advisor (big model on demand)

The `advisor` agent is registered but **unbound by default**: delegating to it
is rejected until a model is bound. Bind it two ways:

- Runtime, session-scoped (nothing written to disk):

  ```
  /advisor                    # report current binding
  /advisor neuralwatt/glm-5.2 # bind for this session (validated via catalog)
  /advisor off                # unbind
  ```

- Persistent: `agents.advisor.model` in `~/.omo/omo.jsonc`. A session binding
  takes precedence over config.

While bound, `task(subagent_type="advisor", ...)` sends a distilled brief (goal,
what was tried, the blocker) and expects short directives — the advisor never
implements, only steers.

## Cost playbook

- The orchestrator never self-implements beyond trivial edits; it delegates via
  `task()` and picks the subagent model per task through `catalog_pick`
  (cheapest adequate: `speed`/`cheap` → flash tier, `reasoning` → pro/max tier,
  `vision` → vision-capable).
- Expensive models are never auto-selected: the advisor is delegation-gated
  until bound, and nothing falls back to a premium model by default.
- Heavy chat-injection hooks are default-off (`token_burn.*` flags opt them
  back in). `experimental.aggressive_truncation` + `dynamic_context_pruning`
  default on. Telemetry off.
- Repo-map (below) trades one static context block for the first N exploration
  tool calls of every session.

## Notes

- [DeepSeek Harness (dsh) reference note](./notes/deepseek-harness.md) — retained
  as a provider reference; momo is provider-agnostic, not DeepSeek-specific.

## Repo-map auto-injector (`config.repo_map`)

Replaces the subagent's first few exploration tool calls with one static,
compressed map of the codebase (file tree + highest-centrality symbol
signatures), read directly from the local `.codegraph` SQLite index
(`<projectRoot>/.codegraph/codegraph.db`). Injected once per session into the
first real user message; a no-op when the index is absent. Default **off**;
recommended on for projects with a `.codegraph` index:

```jsonc
// in ~/.omo/omo.jsonc (or <project>/.omo/omo.jsonc)
"repo_map": {
  "enabled": true,
  "token_budget": 1536,   // approximate tokens, chars/4 estimate
  "rank": "centrality"    // in-degree + out-degree over calls edges
}
```

`omo doctor` reports whether the injector is enabled and whether an index was
found.

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
