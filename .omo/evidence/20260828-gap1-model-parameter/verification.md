# Gap 1 — task() model parameter implementation

**Date:** 2026-08-28
**Commit:** Post-4769ff62f (dev branch)
**Status:** ✅ COMPLETE

## Summary

Successfully implemented the `model` parameter for the `task()` tool, enabling the catalog-first vision where the orchestrator calls `catalog_pick` and passes the chosen model to `task()` for delegation.

## Problem Statement

The orchestrator prompt instructed: "call catalog_pick, then pass the returned model to task() via the `model` parameter." However, `delegateTaskArgsSchema` had NO `model` field, making it impossible for the LLM to follow this instruction.

## Solution

Added an optional `model` field to the delegation pipeline with the following precedence:
1. **catalog-picked model** (args.model) — highest priority
2. **explicit category model** (userCategories[category].model)
3. **sisyphusJuniorModel** (global default)
4. **category resolved model** (system default)

## Files Modified

### 1. packages/omo-opencode/src/tools/delegate-task/tools.ts
- Added `model` field to `delegateTaskArgsSchema` (optional string)
- Description: "Provider/model id overriding the category default (e.g., \"anthropic/claude-sonnet-4-6\"). Use catalog_pick to choose the cheapest adequate model."

### 2. packages/omo-opencode/src/tools/delegate-task/types.ts
- Added `model?: string` field to `DelegateTaskArgs` interface

### 3. packages/omo-opencode/src/tools/delegate-task/tool-argument-preparation.ts
- Extract `model` from args and include in returned `DelegateTaskArgs`

### 4. packages/omo-opencode/src/tools/delegate-task/category-resolver.ts
- Added `catalogPickedModel` variable (args.model)
- Updated model resolution precedence to prioritize catalog-picked model
- Updated `modelInfo.source` to include "catalog-pick" as a valid source
- Updated fallback chain logic to bypass hardcoded chain when catalog-picked model is provided

### 5. packages/model-core/src/model-resolver.ts
- Added "catalog-pick" to `ModelSource` type union

### 6. packages/omo-opencode/src/tools/delegate-task/catalog-model-override.test.ts (NEW)
- 5 behavioral tests verifying:
  1. Catalog-picked model is used when provided
  2. Category default is used when model not provided
  3. Catalog-picked model takes precedence over category config
  4. Catalog-picked model takes precedence over sisyphusJuniorModel
  5. Catalog-picked model bypasses hardcoded fallback chain

## Test Results

### New Tests
```
5 pass
0 fail
16 expect() calls
```

### Full Delegate-Task Test Suite
```
498 pass
0 fail
1157 expect() calls
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

### Precedence Chain
The implementation correctly enforces the following precedence:

1. **args.model** (catalog-pick) — highest priority
   - Source: "catalog-pick"
   - Type: "user-defined"
   - Bypasses hardcoded fallback chain

2. **userCategories[category].model** (explicit category config)
   - Source: "override"
   - Type: "user-defined"

3. **sisyphusJuniorModel** (global default)
   - Source: "override"
   - Type: "user-defined"

4. **category resolved model** (system default)
   - Source: "category-default" or "system-default"
   - Type: "category-default" or "system-default"

### Fallback Chain Behavior
When a catalog-picked model is provided:
- `fallbackChain` is set to `undefined`
- This prevents the system from using hardcoded fallback chains
- The chosen model is used as-is (like the existing override path)

## Integration with Orchestrator Prompt

The orchestrator prompt (momo-orchestrator.ts) already instructs:
```
Before EVERY task() call, you MUST call catalog_pick to choose the model.
Never assume the category default model is the best choice.

Workflow:
1. Determine task requirements
2. Call catalog_pick with task description
3. Use the returned model in your task() call
```

With this implementation, the LLM can now:
1. Call `catalog_pick` to get the cheapest adequate model
2. Pass that model to `task()` via the `model` parameter
3. The delegation pipeline will use that model instead of the category default

## Example Usage

```typescript
// Orchestrator calls catalog_pick
const pickedModel = await catalog_pick({
  task: "Implement user authentication",
  category: "deep"
})
// Returns: "anthropic/claude-sonnet-4-6"

// Orchestrator calls task() with the picked model
await task({
  category: "deep",
  model: "anthropic/claude-sonnet-4-6",  // <-- NEW PARAMETER
  prompt: "Implement user authentication with JWT tokens...",
  run_in_background: true
})

// The delegation pipeline will use "anthropic/claude-sonnet-4-6"
// instead of the category default (e.g., "openai/gpt-5.6-sol")
```

## Backward Compatibility

✅ **Fully backward compatible**
- The `model` parameter is optional
- Existing code that doesn't pass `model` continues to work unchanged
- All existing tests pass without modification

## Alignment with Advisor Pattern

The implementation mirrors the advisor delegation gate pattern:
- Advisor gate: session binding overrides config model
- Catalog pick: args.model overrides category default
- Both bypass the normal resolution pipeline when an override is present
- Both set `fallbackChain` to `undefined` to prevent hardcoded chains

## Next Steps

Gap 1 is now complete. The catalog-first vision is functional:
- Orchestrator can call `catalog_pick` to choose models
- Orchestrator can pass the chosen model to `task()`
- Delegation pipeline respects the chosen model

Remaining work:
- Gap 2: momo-plan-mode wiring (lower priority)
- Phase 6: README documentation updates
- Deferred: Token-burn live chat-session evidence (requires real provider session)
