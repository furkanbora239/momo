# decision-core — Jev System One Decision-Engine Primitives (Core)

**Generated:** 2026-10-02

## OVERVIEW

Harness-neutral primitives for the Jev (TypeSafe System One) decision engine that replaces the LLM "manager" triage agent. Three layers: (1) a typed HTTP client against Zen's `/v1/systemone` endpoint with retry/breaker-aware transport; (2) pure question-builder functions that produce the schema-valid `criteria` dicts (Zen rejects `options` arrays with HTTP 422); (3) a two-stage decision engine (stage1 path + effort, stage2 model + lane) with a circuit breaker and confidence gates. Pure TypeScript — zero dependencies, HTTP injected via `PostJson` so tests never touch the network. Package: `@oh-my-opencode/decision-core`.

## PUBLIC API (`src/index.ts` barrel)

| Module | Key exports |
|--------|-------------|
| `types.ts` | `PathOption`, `ModelCandidate`, `ChoiceQuestion`, `ScoreQuestion`, `NoulQuestion`, `JevQuestionSet`, `ChoiceAnswer`, `ScoreAnswer`, `NoulAnswer`, `JevAnswers`, `JevUsage`, `JevCallResult`, `PostJson`, `DecisionTask`, `DecisionResult`, `DecisionCoreError` |
| `jev-client.ts` | `createJevClient(deps)` → `{ ask(state, questions) }` |
| `schema.ts` | `buildPathQuestion`, `buildEffortQuestion`, `buildModelQuestion`, `buildLaneQuestion` |
| `decision-engine.ts` | `createDecisionEngine(deps)` → `{ decide(task) }` |

### Client contract (`createJevClient`)

- Resolves the API key at **call time** via `getApiKey()` (never cached/stored).
- Sends `Authorization: Bearer <key>`, `Content-Type: application/json`, `User-Agent: momo-decision-core/1.0 (opencode client)` (plain SDK UAs are blocked by Cloudflare 1010), `x-opencode-session`.
- Rejects any question carrying an `options` array **before** any network call (`DecisionCoreError` code `invalid-question`).
- Retries on HTTP 422/429/529 and transport errors up to `maxAttempts` (default 5), sleeping `retryDelaysMs` between attempts. Non-retryable 4xx → `http`; persistent retryable failure → `jev-unavailable`.
- `costUsd = inputTokens * 0.042 / 1_000_000` (Zen at-cost input price; output free).

### Engine contract (`createDecisionEngine`)

- Stage 1: `ask` with `path` (choice) + `effort` (score). Confidence gate on `path` (`confidenceThreshold`, default 0.75) → fallback `low-confidence-stage1`.
- `buildCandidates({path, effort, task})`; empty → fallback `no-candidates`.
- Stage 2: `ask` with `model` (choice over candidates) + `lane` (choice). Confidence gate on `model` → fallback `low-confidence-stage2`.
- Circuit breaker: `breakerFailures` (default 3) consecutive client errors opens for `breakerCooldownMs` (default 600_000); while open, `decide` short-circuits with `breaker-open` and zero client calls.
- Never throws to the caller — errors become fallback results with a `reason`.

## DEPENDENCIES & CONSUMERS

- **Depends on:** nothing (pure TS; transport injected).
- **Consumed by:** none yet — the omo-opencode plugin wiring is a later PR. This package ships harness-neutral primitives only.

## NOTES

- `criteria` MUST be a dict for choice questions; Zen's `/v1/systemone` returns HTTP 422 for `options` arrays (verified live).
- Live-validated two-stage accuracy: stage1 path 95% + effort (score MAE 0.82); stage2 model selection among 4-6 pricing-fact-bearing candidates 82.5% + lane 100%.
- Parent: [`packages/AGENTS.md`](../AGENTS.md).
