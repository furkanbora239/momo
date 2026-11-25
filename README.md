# momo — My Oh My Openagent

> **MODIFIED SOFTWARE NOTICE**  
> This repository is a token-efficient, cheap-provider-first modified fork of [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (upstream npm packages: `oh-my-opencode` / `oh-my-openagent`).  
> Distributed under the original [Sustainable Use License 1.0 (SUL-1.0)](./LICENSE.md) (**not** OSI open source).  
> Upstream documentation is available in the [oh-my-openagent repository](https://github.com/code-yeongyu/oh-my-openagent#readme).


momo extends OpenCode v2 with a session-model orchestrator, a configurable routing manager, departments, workers and on-demand readonly consultation. The OpenCode adapter targets v2.0.24 or later. [The handoff](notes/native-v2-handoff-20261012.md) records the native migration evidence and delivery PRs.

## Execution model

```text
Orchestrator -> Manager/Jev -> worker or department
Department -> Manager/Jev -> worker
Orchestrator / department / worker -> Manager/Jev -> advisor
```

The orchestrator determines tasks and combines results. Its model comes from the OpenCode session selection (`/models`). Manager is a replaceable routing service. It sees the task brief and the eligible connected catalog, including price provenance, context limits, tools, researched profiles and runtime outcomes. Unknown price or ability remains unknown. Model research runs in the background.

Departments are planner, executor and reviewer. They own sessions and may assign workers, but cannot open another department. Worker roles are worker, explore, librarian, research and catalog-researcher. Workers can consult but cannot delegate. Advisors can research readonly; they cannot edit, delegate or consult. Coordinators cannot edit or run general shell commands. Direct worker mode remains available in native agent selection.

Jev decisions are applied to both the role and model. Low confidence returns up to three choices; Jev errors return the eligible pool. The caller finishes the existing decision ticket, with fresh availability and pool checks. Selection does not call Jev again or create a second task. There is no silent model substitution.

## Install from this checkout

Use Bun in the root workspace. The vendored Node-targeted MCP packages have their own build tooling.

```bash
bun install
bun run build
```

Register the package root in OpenCode v2 configuration:

```json
{
  "plugins": ["file:///absolute/path/to/momo"]
}
```

OpenCode loads the package's `./tui` export from that registration. Do not add duplicate entries to `cli.json` or `tui.json`. momo distributes owned markdown agent files and preserves conflicting user-owned files.

Start `opencode`, connect an account with `/connect` and select the orchestrator's model with `/models`. Use `/momo-routing` to set up delegation and `/mcp-policy` to set MCP modes for the project.

## Routing profiles

Open `/momo-routing` and choose **Automatic**, **ChatGPT** or **OpenCode Go**. Set a decision model and worker pool, or choose **Fill with AI** and select a connected chat model to prepare a draft. ChatGPT and Go drafts favor the corresponding provider. Review the proposed choices and select **Apply profile** to activate the draft. **Fill unavailable choices with AI** repairs unavailable entries in a saved profile while preserving eligible choices.

The decision model may use configured Jev, a connected chat model, or caller selection. Chat decisions use a tool-free OpenCode generation request with the task brief and eligible role/model options. Momo validates the answer against the current pool and existing role rules. A configured backup can handle a failed decision request. Unresolved decisions return the candidates on the same task. Chat generation uses the selected provider's allowance or API billing. Jev's budget applies to Jev requests.

The worker pool offers **All eligible models**, **Only selected models** and **Pause delegation**. An empty explicit selection allows zero models. `Ctrl+Space` toggles models without clearing a filter and `Ctrl+S` keeps the selections in the draft. Advisor and research models are optional and must pass the worker pool when dispatched. Catalog maintenance can inherit existing settings, use a chosen researcher, or be turned off. Background Jev classification pauses for chat and manual decision profiles.

Profiles take effect on save and are kept per project in Momo's private data directory. Existing installations use their previous pool, advisor and Jev settings until a profile is applied. Provider routing permissions apply across projects and can be inspected separately from OpenCode connection and quota status. `/pool`, `/providers` and `/advisor-pool` remain shortcuts into the routing panel. **Show alongside session** opens the active routing status in OpenCode's session panel.

## Task and consultation tools

- `momo_task`: create, resume, select, answer, cancel, status and wait.
- `momo_consult`: start a single-question consultation, select, status and wait.

Task text is the required brief; scope and acceptance criteria are optional. Normal task requests do not choose a model or role. Caller identity and delegation permissions come from the actual OpenCode session. Default assignment runs in the background; explicit waiting is supported.

Tasks persist their root/parent/session lineage, routing decision, attempts, progress, question, children, outcome and delivery. Completion and delivery are separate. Managed question wakeups pass through model/provider capacity. Restart reconciles native sessions and resumes interrupted work in the same session; completed or cancelled work is not rerun. These behaviors have isolated live evidence; remaining fault and timeout cases are listed in the handoff.

## Configuration and cost controls

momo reads layered `.omo/omo.jsonc` configuration, including the `[opencode]` block. Model identifiers below are placeholders for connected models:

```jsonc
{
  "[opencode]": {
    "manager": {
      "jev": {
        "confidence_threshold": 0.75
      },
      "advisor_models": [
        { "providerID": "your-provider", "id": "your-advisor-model" }
      ]
    },
    "background_task": {
      "defaultConcurrency": 5
    }
  }
}
```

The default manager uses public `opencode/jev-1.13-free` without an account key. Explicit paid models and custom endpoints retain provider authentication. To choose the public binding explicitly, set `manager.jev` to `{ "model": "jev-1.13-free", "provider_id": "opencode", "authentication": "none", "base_url": "https://opencode.ai/zen/v1" }`. Anonymous access is limited to this official binding; it never falls back to a paid model.

The native catalog enriches exact provider/model identities with bounded, cached models.dev descriptions, reasoning traits and published prices. Only verified zero prices count as free. Disconnected official OpenCode providers expose verified public free models while provider toggles and pool restrictions still apply. Job classifications are cached recommendations, not measured performance claims. Runtime roles determine direct versus department execution. If several models make the preference uncertain, at most three candidates receive task adequacy checks; insufficient evidence still returns caller selection.

Model research ships in [`packages/omo-opencode/assets/model-catalog.json`](packages/omo-opencode/assets/model-catalog.json). Exact model identities and reviewed aliases reuse the same card across provider endpoints; provider prices and availability stay separate. Known cards do not expire or trigger research at startup. Previously unknown active, pool-allowed models are researched one at a time while the foreground is idle, before job classification. Without an explicit `catalog.research_executor`, only a currently verified free, tool-capable executor may run; no free executor leaves research paused. Set `catalog.auto_research` to `false` to disable automatic discovery. Local research stays in `~/.omo/native/catalog-knowledge.json`; `oh-my-opencode catalog export` creates a contribution file for review and a PR, and `catalog validate` checks its schema. See [the contribution guide](packages/omo-opencode/assets/MODEL_CATALOG.md).

Native agents discover current operations with `momo_task` or `momo_consult` `help` and inspect effective `capabilities`. Detailed schemas come from the same strict validators used at execution; short discovery definitions do not weaken role or task ownership checks. Use `view: "brief"` for lifecycle monitoring and follow `nextActions`, then read `detail` or `result` when needed. Missing task information belongs in the native `question` channel; consultation requests advice from an eligible explicitly configured advisor. Worker agents may consult but cannot delegate.

An empty advisor pool disables consultation. Advisors must also pass the general hard-allow pool. The general pool in `~/.omo/model-pool.json` allows all when missing or valid and empty. Malformed or unreadable native routing controls fail closed. Provider toggles and fresh model availability are checked at dispatch. Existing concurrency and timeout settings remain configurable; native defaults protect active tools for up to 60 minutes and detect silence without active tools after three minutes.

The versioned decision ledger records the actual manager inputs, candidate snapshot, response/fallback, caller selection, dispatch, usage and outcome links. It does not copy every chat. Research claims stay separate from verified task results. Export can include old ledger rows through a readonly legacy path.

## Code search and retained adapters

External connectors are managed separately from their project policy. The installer preserves a private backup and records startup ownership in a private catalog for the active OpenCode configuration directory and marks native `mcp.servers` entries dormant. Definitions stay in OpenCode configuration so its environment/file interpolation remains intact. Existing installations can run `oh-my-opencode mcp-manage` (optionally `--config /absolute/path/opencode.jsonc`) before restarting OpenCode. This ownership change prevents OpenCode from starting all global connectors before plugins initialize. The catalog stores only ownership fingerprints and original disable flags; credentials remain in native configuration and private backups. Snapshots and project policy contain no commands, headers or environment secrets. Back up and retain the reported original configuration if removing momo later; without momo, managed connectors remain disabled until their native startup flags are restored. The command rejects a conflicting existing definition instead of replacing it silently.

`/mcp-policy` distinguishes `off`, `on-demand`, and `always` from the actual connection state. Native search defaults to always, known graph servers to off, and managed external connectors to on-demand. Native disables present when a connector is adopted and `disabled_mcps` remain hard denies. An agent can use `momo_mcp` to inspect, activate or release a known connector, but this control tool cannot change persistent policy or add servers. Activation does not grant new role permissions: readonly coordinators still delegate external writes. On-demand leases last until released or the native service restarts. Turning a connector off blocks new calls immediately and waits for admitted calls before disconnecting. Project policies are saved under `[opencode].mcp_policy` in `.omo/omo.jsonc`; leases are not persisted. A connector still owned by host configuration is marked in the panel because runtime filtering alone cannot prevent its initial host startup.

Native search uses bundled LSP and ast-grep plus file reading and text search. Role policy restricts rename/rewrite to workers and denies unknown MCP tools for readonly roles. Codebase Memory MCP v0.11.0 is an optional pinned candidate; it stays disabled because automatic index freshness did not pass QA. Its managed cache includes its upstream license notice. The old Codegraph default is not restored.

Codex, Senpi, native CLI and shared core packages remain in-tree. The OpenCode native entry does not activate old V1 client/hook/config bridges, translator commands, category delegation or legacy task sidebars. Programming skills may remain optional for workers. [The archived v1 README](notes/momo-v1-readme.md) preserves historical descriptions and attribution.

## Development and verification

```bash
bun run typecheck
bun test
bun run build
```

Typecheck uses tsgo. Run focused behavioral tests and isolated actual OpenCode QA for runtime changes. Keep evidence under `.omo/evidence/`; watch Bun processes because some tests can hang. Never use the user's actual OpenCode database for spawned QA sessions.

Current evidence and remaining work: [migration contract](NATIVE_V2_MIGRATION.md), [handoff](notes/native-v2-handoff-20261012.md), [project state](PROJECT_STATE.md). Work lands through reviewable PRs into `dev`; `main` advances only through a verified dev-to-main PR.

## License and attribution

Original project: [oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent), by YeonGyu Kim and contributors. All upstream copyright and license notices remain. momo is modified software under [SUL-1.0](LICENSE.md), not OSI open source. Free non-commercial use and redistribution follow that license; commercial use requires upstream licensing. Do not relicense this fork.
