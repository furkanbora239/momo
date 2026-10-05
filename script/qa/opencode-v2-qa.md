# M7 — opencode-v2 migration standing QA infra

Runbook item **M7** closes the "empty-child P3" gap from M1d: inside an isolated
XDG sandbox the `opencode-go` provider is inactive, so children dispatched with
`opencode-go/deepseek-v4-flash` fail at provider resolution. Three deliverables:

1. **Provider cache seed** — makes the sandbox resolve `opencode-go/deepseek-v4-flash` deterministically.
2. **`--self-test` driver** — wraps the M1d pattern end to end (sandbox up → pre-flight asserts → 5 parallel children → wait → dump → verdict → cleanup).
3. **Standing regression exam** — one command encoding the repeatable checks (survive+complete, tool surface, no verdict-noise).

## Files (all under `script/qa/`)

| File | Purpose |
|------|---------|
| `opencode-v2-qa-seed.ts` | Seed provider cache + config into an isolated XDG sandbox. |
| `opencode-v2-qa-driver.ts` | The M1d driver engine + pre-flight hard asserts; CLI with `--self-test` / `--full` / `--regression`. |
| `opencode-v2-qa-exam.ts` | Standing regression exam (one command). |
| `opencode-v2-qa-types.ts` | Shared constants/types (routes, markers, model, waits). |
| `opencode-v2-qa-tool-surface.json` | Expected child tool-surface manifest (requiredBaseline + advisoryPresence). |
| `opencode-v2-qa-seed.test.ts` | Focused unit test for the seed transform (no server). |

## What the seed copies / generates (and why)

The seed writes into an isolated XDG sandbox (`XDG_DATA_HOME` / `XDG_CONFIG_HOME` /
`XDG_STATE_HOME` / `XDG_CACHE_HOME` under a temp dir). The real opencode state is
only **read** — nothing under `~/.local/share/opencode` or `~/.config/opencode` is
modified.

- `config/opencode/opencode.json` — **copied**, then patched: an explicit
  `opencode-go` provider block is injected (base URL taken from the real `go-b`
  provider, api key taken from `auth.json`'s `opencode-go.key` and written as a
  literal — never printed). In the sandbox the real `go-b` provider cannot
  authenticate (its key is an env var that is absent), so momo's catalog never
  injects `opencode-go` and children fail at resolution. Adding `opencode-go` as a
  first-class provider makes the model resolvable regardless of live reconciliation.
- `config/opencode/service.json` — **copied**: the `opencode serve` Basic-auth password.
- `data/opencode/auth.json` — **copied**: provider API keys for any non-seeded provider.
- `cache/oh-my-opencode/provider-models.json` — **generated**: the momo
  provider-models cache, so `opencode-go` is reported connected before the live
  `/models` reconciliation finishes.
- `cache/oh-my-opencode/connected-providers.json` — **generated**: the momo
  connected-providers cache.

**Documented fallback**: if `opencode-go` is genuinely unreachable at runtime, the
seeded cache still lets the harness *resolve* the model and dispatch the child; the
child then fails gracefully at the API call (terminal, not killed) — which is
exactly what the M1d kill-storm fix guarantees. The regression exam asserts
*survival + completion*, not summary quality, so it stays green either way.

## Usage

```bash
# 1. Seed plan (no writes) / apply to a sandbox dir
bun script/qa/opencode-v2-qa-seed.ts --plan
bun script/qa/opencode-v2-qa-seed.ts --apply /tmp/my-sandbox

# 2. Self-test (quick harness proof, ~40s, exits 0 on a healthy harness)
bun script/qa/opencode-v2-qa-driver.ts --self-test

# 3. Full M1d pattern (~120s, writes evidence)
bun script/qa/opencode-v2-qa-driver.ts --full

# 4. Standing regression exam (one command)
bun script/qa/opencode-v2-qa-exam.ts
```

Evidence is written to `.omo/evidence/20261005-m7-qa-infra/`
(`summary.md`, `greps.txt`, `sessions.json`, `serve-log-excerpt.log` — all
password/key-redacted). The sandbox temp dir is removed on success unless
`--keep` is passed.

## Hard pre-flight asserts (run BEFORE any prompting)

The driver exits non-zero naming the failing assert if any of these fail:

- `health returns JSON` — `GET /api/session` returns JSON, **not** the v1
  `/global/health` HTML catch-all.
- `POST /api/session returns non-empty id` — the parent session id is non-empty.
- `momo plugin loaded` — `opencode-go` appears in `GET /api/provider` (polled up to
  30 s, async reconciliation) **and** `serve.log` shows a momo-plugin marker
  (`model-catalog-cli.ts` / `oh-my-opencode` / `v2-compaction-hook-bridge`).

## Operational gotchas already handled

- **V2 routes only**: `GET /global/health` is an SPA catch-all — never used.
- **Basic auth** `opencode:<password>` where the password comes from
  `~/.config/opencode/service.json` (read from the seeded sandbox copy).
- **Free port**: a verified-free port is chosen before binding.
- **No tmux**: the server is launched via `Bun.spawn` (avoids the silent-breakage
  single-quote-in-`tmux new-session` gotcha).
- **Secrets redacted** in every console line, log excerpt, and evidence file.
- **Real server untouched**: the driver uses its own isolated sandbox + free port;
  it never writes to `~/.local/share/opencode` or the live server (PID 7710 / 49374).

## Regression gate classes

| Class | Check | Hard? |
|-------|-------|-------|
| survive+complete | `childCount >= 5`, every child produced messages | yes |
| tool surface | union of child tool names intersects `requiredBaseline` (`read`/`shell`/`execute`/`edit`) | yes |
| no verdict-noise | `gone from status` = 0, `Step interrupted` = 0, `degrading to no-op` = 0 | yes |

`advisoryPresence` (`codegraph`/`websearch`/`webfetch`/`skill`) is reported only
until M2 lands the worker baseline read-side surface; promote it to a hard gate in
`opencode-v2-qa-tool-surface.json` afterward.
