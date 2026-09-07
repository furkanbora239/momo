# Retroactive QA — momo commit dd810b3c8

**Date:** 2026-08-24
**Commit under test:** `dd810b3c8` — *feat(opencode): momo fork — catalog MCP, advisor agent, v1 roster, token-burn gates*
**Verification passes:** four (initial QA + three follow-ups).

---

## TL;DR — Pass 4 (current state)

Both Bug A (advisor runtime surface) and Bug B (momo doctor check) are **now genuinely fixed on the working tree**, and Task 1 (the `dist bundle prompt content` test) is also fixed.

| Item | Result |
|---|---|
| Bug A (advisor) | **FIXED** — wiring confirmed in subagent-resolver.ts (gate), tool-registry-core-tools.ts (advisor tool), general-agents.ts (skip removed), commands.ts (template updated). |
| Bug B (doctor) | **FIXED** — `momo-roster` moved to `getAllCheckDefinitions()`. `bun dist/cli/index.js doctor --verbose` reports `Total: 9 checks` and the `momo Roster & Catalog` row appears. |
| Task 1 (`dist bundle prompt content`) | **PASS** after fix to fixture write (nesting under `[opencode]` — see "Task 1 fix detail" below). |
| Task 2 (focused suites) | PASS — 1574 pass / 3 fail (the 3 known pre-existing codex-components env failures). |
| Task 3a (advisor harness) | **PASS** — the plugin's delegation gate and advisor tool were driven end-to-end via the same source modules the dist bundle contains; the unbound→reject, bind→bound, off→unbound cycle is captured. (3a.1: advisor not in the empty-sandbox runtime agent map — expected, see note.) |
| Task 3b (roster) | **PASS** — doctor shows `momo Roster & Catalog` and `v1 roster (surfaced): sisyphus, explore, librarian, advisor (when bound)`. |
| Task 3c (token-burn) | **DEFERRED** — chat-session behavior depends on an LLM; the wiring is present in `testing/create-plugin-module.ts` (`isHookEnabled` consults `token_burn`). Not collected this pass. |
| Isolation | Holds — real DB session count 51 at baseline → 51 after every harness run. |
| Commits made | None. |

---

## Pass 4 detail

### Wiring verified (quick grep, as instructed)

```
$ grep -n "resolveAdvisorDelegationGate" packages/omo-opencode/src/tools/delegate-task/subagent-resolver.ts
8:import { resolveAdvisorDelegationGate } from "./advisor-delegation-gate"
31:  const advisorGate = resolveAdvisorDelegationGate(agentToUse, executorCtx.agentOverrides, options.parentSessionID)

$ grep -n "createAdvisorTool" packages/omo-opencode/src/plugin/tool-registry-core-tools.ts
132:    advisor: factories.createAdvisorTool({

$ git diff packages/omo-opencode/src/agents/builtin-agents/general-agents.ts | grep -E "^[+-]" | grep -i "advisor\|sessionId"
-import { getSessionAdvisorBinding } from "../advisor-binding"
-  sessionId?: string
-  -    sessionId,
-  if (agentName === "advisor" && !agentOverrides.advisor?.model && !getSessionAdvisorBinding(sessionId ?? "")) continue
```

Advisor skip removed; registration is unconditional (modulo model resolution). All tracked edits present (commands.ts template, tool-registry-*, subagent-resolver, etc.).

### Task 1 fix detail — `dist bundle prompt content`

The test boots the dist plugin with an empty `HOME` fixture. With the v1 roster default injected by `config/validate.ts` `mergeViews` (`disabled_agents: V1_DISABLED_AGENTS_DEFAULT` when omitted), Prometheus is skipped at `agent-config-assembly.ts:116`, and the runtime agent list contains no Prometheus — so the test's `.find(prompt === sourcePrometheusPrompt)` returns `undefined`.

**Fix:** in the test fixture, write a user omo config that suppresses the v1 default. The omo harness-neutral schema is strict at the top level, but the OpenCode-specific key lives under the `[opencode]` block (which the harness-neutral schema accepts as an opaque record and `OhMyOpenCodeConfigSchema` then parses). The fixture now writes `{"[opencode]":{"disabled_agents":[]}}` to `homeDirectory/.omo/omo.jsonc`. This is **not** hacking around the migration — it is the canonical harness-specific location for the OpenCode adapter. With this write, `mergeViews` sees a non-undefined `disabled_agents` and does not inject the v1 default; the empty array suppresses it cleanly.

**Do NOT change `V1_DISABLED_AGENTS_DEFAULT` or `mergeViews`** — the default is correct for production; only the test fixture opts out.

Test result after fix: `bun test packages/omo-opencode/src/shared/dist-bundle-prompt-content.test.ts` → **1 pass**.

### Task 3a harness detail

**3a.1 — Runtime agent map** (boot dist in sandbox, list agents):

```
{"agentCount":5,"agentNames":["Sisyphus - ultraworker","build","explore","librarian","plan"],"advisorRegistered":false,"note":"empty sandbox; no session model so advisor is not registered; the delegation-time gate enforces unbound regardless"}
```

In the empty sandbox there is no session model, so the advisor agent (which requires a resolvable model to register) is not added to the runtime agent map. The delegation-time gate enforces "unbound" regardless of whether the advisor agent is registered. With a connected opencode session (real model), the advisor agent registers and the gate controls real binding. This is a harness-environment limitation, not a fix problem.

**3a.2 — Delegation gate + advisor tool full cycle** (drives the EXACT runtime functions the plugin wires):

```
{"step":"1-unbound-delegation","gateKind":"unbound","gateError":"The advisor agent is UNBOUND (zero surprise cost by default). Bind a model first: run /advisor <model-id> for a session-scoped binding, or set agents.advisor.model in ~/.omo/omo.jsonc for a persistent one. Then retry the delegation."}
{"step":"2-bind-via-advisor-tool","toolOutput":"advisor: bound to \"neuralwatt/glm-5.2\" for this session. Delegation to the advisor agent is now enabled and will use this model. Use action=\"off\" to unbind.","sessionBinding":"neuralwatt/glm-5.2"}
{"step":"3-bound-delegation","gateKind":"bound","gateSessionModel":"neuralwatt/glm-5.2","sessionBinding":"neuralwatt/glm-5.2"}
{"step":"4-off-via-advisor-tool","toolOutput":"advisor: session binding cleared. The advisor is now UNBOUND; delegation to it will be rejected."}
{"step":"5-unbound-again","gateKind":"unbound","gateError":"...same unbound error..."}
{"step":"6-report-after-off","toolOutput":"advisor: UNBOUND. No session binding and no agents.advisor.model config. Bind one with the advisor tool ..."}
{"step":"7-off-with-config-binding","toolOutput":"advisor: session binding cleared. The config binding \"google/gemini-3.1-pro\" (agents.advisor.model) still applies."}
```

All seven steps capture the expected behavior: unbound→reject (1, 5), bind via advisor tool (2), delegation bound (3), off via advisor tool (4), report after off (6), and off with a config binding still applying (7). The probe imports the same source modules the dist bundle contains, so this exercises the exact functions the plugin wires at delegation time and via the tool registry.

### Task 3b harness detail

```
$ bun dist/cli/index.js doctor --verbose
  ...
  Total: 9 checks in 5403ms

  momo Roster & Catalog
  ────────────────────────────────────────
  v1 roster (surfaced): sisyphus, explore, librarian, advisor (when bound)
  catalog MCP: enabled (cached models: no cache yet)
  advisor: config-unbound (zero surprise cost)
  disabled agents: prometheus, metis, momus, hephaestus, oracle, atlas, sisyphus-junior, multimodal-looker
```

The `momo Roster & Catalog` row appears in the standard `bun dist/cli/index.js doctor` output. `Total: 9 checks` (was 8 before the fix). The v1 roster is correctly disabled by default.

### Isolation

Real `~/.local/share/opencode/opencode.db` `SELECT count(*) FROM session`:

| Stage | Count |
|---|---|
| baseline (before any harness runs) | **51** |
| after Task3b doctor run | 51 |
| after Task3a.1 dist boot | 51 |
| after Task3a.2 probe | 51 |
| **final** | **51** |

No sandbox session leaked into the real DB.

### Task 3c (token-burn) — DEFERRED

Token-burn gates control chat-injection hooks (`agent_usage_reminder`, `category_skill_reminder`, `todo_description_override`) and `rules_injector_verbose`. The wiring is present in `packages/omo-opencode/src/testing/create-plugin-module.ts` (the `isHookEnabled` closure now consults `pluginConfig.token_burn` for the three default-off hooks). Proving "hook does NOT fire" requires observing chat-session message parts with and without the gates enabled. That requires a chat session, which requires an LLM. The wake-split fake-LLM harness could be extended, but the fake LLM's canned branches don't naturally exercise chat hooks. **Deferred** — the wiring is verified by source inspection; live chat-hook evidence is left for a future pass with a real provider.

### Files in this evidence dir (pass-4 additions)

- `evidence_report.md` — this report (updated for pass 4).
- `run.sh` — reproducible harness driver (Task 1 fix + Task 3a + Task 3b).
- `advisor-flow.probe.ts` — the bun probe driving the delegation gate and advisor tool (Task 3a.2).
- `doctor.local-fork-verbose.p4.txt` — pass-4 doctor output (`Total: 9 checks`, momo present).
- `3a.1-advisor-registration.json` — runtime agent map probe.
- `3a.2-advisor-flow.jsonl` — full advisor flow JSONL (7 steps).
- `3a.1-advisor-registration.err`, `3a.2-advisor-flow.err` — stderr (empty/noise).
- `isolation.log`, `isolation.final.p4.txt` — isolation proof.
- (Earlier-pass files retained: `doctor.local-fork-verbose.txt`, `catalog_mcp.stdio.jsonl`, etc.)

---

## Earlier passes (summary)

- **Pass 1** — established isolation harness; identified Bug A (no runtime binding surface) and Bug B (`momo-roster` in codex array).
- **Pass 2** — first claim that fixes were applied was false; verified (via exhaustive grep) that none of the wiring edits were present.
- **Pass 3** — second claim same as pass 2 was also false; same exhaustive grep.
- **Pass 4 (this)** — the wiring is genuinely present, the test fix is applied, and the harness evidence is captured. The doctor's `momo Roster & Catalog` row now appears in the standard check list and the advisor gate/tool cycle works end-to-end.

---

## Bottom line

Both bugs are fixed and verified by the harness. The `dist bundle prompt content` test required a fixture change (nesting under `[opencode]`) that is the canonical harness-specific config location — not a hack. Isolation holds (51 → 51). No commits made. The remaining gap is token-burn live chat-session evidence, which depends on a chat session / LLM and is deferred.

Working tree: 14 modified tracked files (the wiring + the dist-bundle test fix) + 3 untracked new files (advisor tool + gate). HEAD still `dd810b3c8`. Awaiting commit decision.