# momo — My Oh My Openagent

> **MODIFIED SOFTWARE NOTICE**  
> This repository is a token-efficient, cheap-provider-first modified fork of [code-yeongyu/oh-my-openagent](https://github.com/code-yeongyu/oh-my-openagent) (upstream npm packages: `oh-my-opencode` / `oh-my-openagent`).  
> Distributed under the original [Sustainable Use License 1.0 (SUL-1.0)](./LICENSE.md) (**not** OSI open source).  
> Upstream documentation is available in the [oh-my-openagent repository](https://github.com/code-yeongyu/oh-my-openagent#readme).


momo extends OpenCode v2 with a session-model orchestrator, a Jev routing manager, departments, workers and on-demand readonly consultation. The OpenCode adapter targets v2.0.24. The native migration is being verified; remaining release gates are recorded in [the handoff](notes/native-v2-handoff-20261012.md).

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

Start `opencode`, choose the orchestrator and select its session model. Use native agent/task visibility. `/pool`, `/providers` and `/advisor-pool` manage routing controls.

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

An empty advisor pool disables consultation. Advisors must also pass the general hard-allow pool. The general pool in `~/.omo/model-pool.json` allows all when missing or valid and empty. Malformed or unreadable native routing controls fail closed. Provider toggles and fresh model availability are checked at dispatch. Existing concurrency and timeout settings remain configurable; native defaults protect active tools for up to 60 minutes and detect silence without active tools after three minutes.

The versioned decision ledger records the actual manager inputs, candidate snapshot, response/fallback, caller selection, dispatch, usage and outcome links. It does not copy every chat. Research claims stay separate from verified task results. Export can include old ledger rows through a readonly legacy path.

## Code search and retained adapters

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
