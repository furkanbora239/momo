# Gap Resolution Summary — 2026-08-28

**Status:** ✅ BOTH GAPS COMPLETE

## Gap 1 — task() model parameter (BLOCKER)

**Problem:** The orchestrator prompt instructed to call catalog_pick and pass the model to task(), but task() had no model parameter.

**Solution:** Added optional `model` field to delegation pipeline with highest precedence.

**Files Modified:**
- `packages/omo-opencode/src/tools/delegate-task/tools.ts` — Added model field to schema
- `packages/omo-opencode/src/tools/delegate-task/types.ts` — Added model to DelegateTaskArgs
- `packages/omo-opencode/src/tools/delegate-task/tool-argument-preparation.ts` — Extract model from args
- `packages/omo-opencode/src/tools/delegate-task/category-resolver.ts` — Use model as highest-priority override
- `packages/model-core/src/model-resolver.ts` — Added "catalog-pick" to ModelSource type
- `packages/omo-opencode/src/tools/delegate-task/catalog-model-override.test.ts` — NEW: 5 behavioral tests

**Evidence:** `.omo/evidence/20260828-gap1-model-parameter/verification.md`

**Test Results:**
- 5 new tests pass
- 498 delegate-task tests pass
- 8352 total tests pass (3 pre-existing env failures)

---

## Gap 2 — momo-plan-mode wiring

**Problem:** buildMomoPlanModePrompt was exported but never called; no trigger path existed.

**Solution:** Folded plan-mode workflow into base momo-orchestrator prompt and deleted separate file (option b).

**Files Modified:**
- `packages/omo-opencode/src/agents/sisyphus/momo-orchestrator.ts` — Added detailed plan-mode workflow
- `packages/omo-opencode/src/agents/sisyphus/index.ts` — Removed momo-plan-mode export

**Files Deleted:**
- `packages/omo-opencode/src/agents/sisyphus/momo-plan-mode.ts`

**Evidence:** `.omo/evidence/20260828-gap2-plan-mode-wiring/verification.md`

**Test Results:**
- 60 sisyphus tests pass
- 8352 total tests pass (3 pre-existing env failures)

---

## Verification

### Typecheck
✅ All packages pass

### Build
✅ build:schema successful
✅ build successful

### Tests
✅ 8352 tests pass
✅ 1 skip
❌ 3 fail (pre-existing codex-components environment failures, unrelated to these changes)

---

## Catalog-First Vision — Now Functional

With both gaps resolved, the catalog-first vision is fully functional:

1. **Orchestrator calls catalog_pick** → gets cheapest adequate model
2. **Orchestrator passes model to task()** → via new model parameter
3. **Delegation pipeline uses chosen model** → bypasses category defaults
4. **Plan mode works naturally** → orchestrator switches based on user request

### Example Workflow

```typescript
// User: "Implement user authentication"

// 1. Orchestrator enters plan mode
// 2. Breaks into tasks
// 3. For each task, calls catalog_pick
const model1 = await catalog_pick({ need: "backend auth implementation" })
// Returns: "neuralwatt/glm-5.2"

const model2 = await catalog_pick({ need: "test generation" })
// Returns: "openai/gpt-5-nano"

// 4. Presents plan
// Plan:
// 1. Task: "Implement JWT auth" → model: neuralwatt/glm-5.2
// 2. Task: "Write auth tests" → model: openai/gpt-5-nano
// Approve? (yes/no)

// 5. User approves
// 6. Orchestrator delegates with chosen models
await task({
  category: "deep",
  model: "neuralwatt/glm-5.2",  // <-- NEW: catalog-picked model
  prompt: "Implement JWT authentication..."
})

await task({
  category: "quick",
  model: "openai/gpt-5-nano",  // <-- NEW: catalog-picked model
  prompt: "Write tests for JWT auth..."
})
```

---

## Remaining Work

### Phase 6 — Documentation (Lower Priority)
- README.md: Provider setup (opencode-go, neuralwatt, google — any N providers)
- README.md: Advisor usage
- README.md: Cost playbook
- README.md: Update "Fork changes (so far)" checkboxes

### Deferred — Token-Burn Evidence
- Live chat-session proof of token savings
- Requires real provider session
- Wiring already verified by source inspection

---

## Commit Readiness

Both gaps are complete and verified. Ready for commit when user gives explicit approval.

**Changes to commit:**
1. Gap 1: task() model parameter (6 files modified, 1 new test file)
2. Gap 2: momo-plan-mode wiring (2 files modified, 1 file deleted)

**Do NOT commit:**
- omo-codex dist artifacts (build side effects)
- Restore with `git checkout` before commit if needed
