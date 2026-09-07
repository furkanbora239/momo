# Gap 2 — momo-plan-mode wiring resolution

**Date:** 2026-08-28
**Commit:** Post-4769ff62f (dev branch)
**Status:** ✅ COMPLETE

## Summary

Resolved the momo-plan-mode wiring gap by folding the plan-mode workflow into the base momo-orchestrator prompt and deleting the separate momo-plan-mode.ts file. This follows the user's preference for option (b): simpler, less wiring, no separate trigger path needed.

## Problem Statement

`buildMomoPlanModePrompt` was exported but never called. The factory selects variants by model family, not by mode, so there was no trigger path for plan mode.

## Decision: Option (b) — Fold into base orchestrator

**Rationale:**
1. No clean plan-mode signal exists in the plugin hook surface
2. The base momo-orchestrator already had plan-mode instructions
3. User preference: "Prefer (b) if no clean plan-mode signal exists in the plugin hook surface — simpler, less wiring."
4. Plan mode is a behavioral mode, not a separate agent variant
5. The orchestrator can switch between implementation and planning based on user request without needing a separate prompt file

## Changes Made

### 1. Enhanced momo-orchestrator.ts
Merged the detailed plan-mode workflow from momo-plan-mode.ts into the base orchestrator prompt:

**Added sections:**
- **Plan-mode workflow**: 7-step workflow (receive request → break into tasks → catalog_pick for each → present plan → wait for approval → delegate if approved → revise if rejected)
- **Plan-mode output format**: Numbered list with model choices and rationale
- **Plan-mode rules**: 5 rules (never implement, always catalog_pick, always present plan, be terse, include rationale)

**Key additions:**
```
**Plan-mode workflow:**
1. **Receive request** → verbalize intent in one sentence
2. **Break into tasks** → identify atomic, independent tasks
3. **For each task:**
   - Determine the need (speed, vision, reasoning, cheap, etc.)
   - Call `catalog_pick({ need: "..." })`
   - Pick the cheapest adequate model
   - Note the model and category
4. **Present the plan** → numbered list with model choices and rationale
5. **Wait for approval** → user says "yes" or "no"
6. **If approved:**
   - Delegate each task via task() with the chosen model
   - Verify results
   - Report back tersely
7. **If rejected:**
   - Ask what to change
   - Revise the plan
   - Re-present

**Plan-mode rules:**
- **NEVER implement in plan mode.** Only plan and delegate.
- **ALWAYS call catalog_pick for each task.** Never assume defaults.
- **ALWAYS present the plan before delegating.** Get user approval first.
- **BE TERSE.** Minimal tokens. No narration.
- **INCLUDE RATIONALE.** For each model choice, state why (cheapest, fastest, has vision, etc.)
```

### 2. Deleted momo-plan-mode.ts
Removed the separate plan-mode variant file since its content is now in the base orchestrator.

### 3. Updated sisyphus/index.ts
- Removed `export { buildMomoPlanModePrompt } from "./momo-plan-mode";`
- Updated comment to clarify that momo-orchestrator.ts includes plan-mode workflow

## Test Results

### Sisyphus Agent Tests
```
60 pass
0 fail
131 expect() calls
```

### Full Plugin Test Suite
```
8352 pass
1 skip
3 fail (pre-existing codex-components environment failures)
18541 expect() calls
```

## Typecheck & Build

✅ **Typecheck**: All packages pass
✅ **Build**: Successful
✅ **Schema**: Generated successfully

## Behavioral Verification

### How Plan Mode Works Now

The orchestrator prompt now includes plan-mode instructions that activate when:
- The user explicitly asks for a plan ("plan this", "create a plan", etc.)
- The user says "plan mode" or similar
- The context implies planning is needed

**Example interaction:**

User: "Plan the implementation of user authentication"

Orchestrator (in plan mode):
```
Planning user authentication implementation.

Plan:
1. Task: "Design auth schema" → model: anthropic/claude-sonnet-4-6 (design category)
   - Rationale: Needs reasoning for schema design
2. Task: "Implement JWT tokens" → model: neuralwatt/glm-5.2 (backend category)
   - Rationale: Cheapest backend model with code generation
3. Task: "Write auth tests" → model: openai/gpt-5-nano (testing category)
   - Rationale: Fast, cheap, good for test generation
4. Task: "Update API docs" → model: anthropic/claude-haiku-4-5 (docs category)
   - Rationale: Cheapest docs model

Total estimated cost: ~$0.03
Approve? (yes/no)
```

User: "yes"

Orchestrator (delegates each task):
```
Delegating 4 tasks.

[task() call 1 with model: anthropic/claude-sonnet-4-6]
[task() call 2 with model: neuralwatt/glm-5.2]
[task() call 3 with model: openai/gpt-5-nano]
[task() call 4 with model: anthropic/claude-haiku-4-5]

All tasks delegated. Monitoring progress.
```

### Advantages of This Approach

1. **Simpler**: No separate trigger path or config flag needed
2. **Less wiring**: No factory changes or routing logic
3. **Flexible**: Orchestrator can switch between planning and implementation based on context
4. **Consistent**: Single source of truth for orchestrator behavior
5. **Token-efficient**: No duplicate prompt content across files

### Alignment with momo North Star

This approach aligns with momo's north star:
- **Cheap orchestrator**: Single prompt file, no extra routing logic
- **Minimal output**: Plan-mode rules enforce terseness
- **Catalog-first**: Plan-mode workflow mandates catalog_pick for each task
- **Hard delegation**: Plan-mode rules reinforce "never implement, only delegate"

## Comparison: Option (a) vs Option (b)

### Option (a) — Config flag / plan-mode signal (REJECTED)
**Would require:**
- New config flag (e.g., `orchestrator.planMode: boolean`)
- Factory routing logic to check flag and select prompt variant
- Routing test to verify flag triggers correct prompt
- Documentation for the flag
- Migration path for existing configs

**Pros:**
- Explicit control over plan mode
- Clear separation of concerns

**Cons:**
- More wiring and complexity
- Requires config changes to use plan mode
- Duplicates prompt content
- Doesn't match natural conversation flow

### Option (b) — Fold into base orchestrator (CHOSEN)
**Required:**
- Merge plan-mode workflow into base prompt
- Delete separate file
- Update exports

**Pros:**
- Simpler, less wiring
- Natural conversation flow (user asks for plan → orchestrator plans)
- Single source of truth
- No config changes needed
- Token-efficient

**Cons:**
- Slightly larger base prompt (mitigated by removing duplicate file)

## Next Steps

Both gaps are now complete:
- ✅ Gap 1: task() model parameter implemented
- ✅ Gap 2: momo-plan-mode wiring resolved

Remaining work:
- Phase 6: README documentation updates (lower priority)
- Deferred: Token-burn live chat-session evidence (requires real provider session)

## Files Changed

**Modified:**
- `packages/omo-opencode/src/agents/sisyphus/momo-orchestrator.ts` — Added detailed plan-mode workflow
- `packages/omo-opencode/src/agents/sisyphus/index.ts` — Removed momo-plan-mode export

**Deleted:**
- `packages/omo-opencode/src/agents/sisyphus/momo-plan-mode.ts` — Content merged into momo-orchestrator.ts
