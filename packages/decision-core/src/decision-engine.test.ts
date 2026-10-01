import { describe, it, expect } from "bun:test"
import { createDecisionEngine } from "./decision-engine"
import { DecisionCoreError } from "./types"
import type { JevCallResult, ModelCandidate } from "./types"
import type { JevClient } from "./decision-engine"

const EFFORT_LEGEND = [
  "1 - trivial",
  "2 - small",
  "3 - moderate",
  "4 - large",
  "5 - very hard",
]

function stage1Result(pathConf = 0.9, effortScore = 3): JevCallResult {
  return {
    model: "jev-1.13",
    answers: {
      path: {
        type: "choice",
        choice: "direct-worker",
        confidence: pathConf,
        probabilities: { "direct-worker": pathConf, department: 1 - pathConf },
      },
      effort: {
        type: "score",
        score: effortScore,
        confidence: 0.9,
        legend: EFFORT_LEGEND,
      },
    },
    usage: { inputTokens: 100, outputTokens: 5 },
    latencyMs: 10,
    costUsd: (100 * 0.042) / 1_000_000,
  }
}

function stage2Result(modelChoice = "hy3", modelConf = 0.9): JevCallResult {
  return {
    model: "jev-1.13",
    answers: {
      model: {
        type: "choice",
        choice: modelChoice,
        confidence: modelConf,
        probabilities: { [modelChoice]: modelConf },
      },
      lane: {
        type: "choice",
        choice: "direct-worker",
        confidence: 0.95,
        probabilities: { "direct-worker": 0.95, department: 0.05 },
      },
    },
    usage: { inputTokens: 200, outputTokens: 5 },
    latencyMs: 20,
    costUsd: (200 * 0.042) / 1_000_000,
  }
}

function fakeClient(responses: JevCallResult[]): {
  client: JevClient
  calls: () => number
} {
  let n = 0
  const client: JevClient = {
    ask: async () => {
      const response = responses[n] ?? responses[responses.length - 1]
      n += 1
      return response
    },
  }
  return { client, calls: () => n }
}

const PATH_OPTIONS = [{ name: "direct-worker", description: "single worker" }]

const TASK = { description: "do the thing", prompt: "implement feature" }

const CANDIDATES: readonly ModelCandidate[] = [
  { name: "hy3", priceLine: "free under Go plan", strength: "fastest codegen" },
]

describe("createDecisionEngine", () => {
  it("happy two-stage path resolves all fields and sums usage", async () => {
    const { client } = fakeClient([stage1Result(), stage2Result()])
    const engine = createDecisionEngine({
      client,
      pathOptions: PATH_OPTIONS,
      buildCandidates: () => CANDIDATES,
    })

    const result = await engine.decide(TASK)

    expect(result.source).toBe("jev")
    expect(result.resolved.path).toBe("direct-worker")
    expect(result.resolved.effort).toBe(3)
    expect(result.resolved.model).toBe("hy3")
    expect(result.resolved.lane).toBe("direct-worker")
    expect(result.usage.inputTokens).toBe(300)
    expect(result.latencyMs).toBe(30)
    expect(result.stage1).toBeDefined()
    expect(result.stage2).toBeDefined()
  })

  it("low stage1 confidence -> fallback low-confidence-stage1", async () => {
    const { client, calls } = fakeClient([stage1Result(0.5)])
    const engine = createDecisionEngine({
      client,
      pathOptions: PATH_OPTIONS,
      buildCandidates: () => CANDIDATES,
    })

    const result = await engine.decide(TASK)

    expect(result.source).toBe("fallback")
    expect(result.reason).toBe("low-confidence-stage1")
    expect(result.stage1).toBeDefined()
    expect(result.stage2).toBeUndefined()
    expect(calls()).toBe(1)
  })

  it("low stage2 confidence -> fallback low-confidence-stage2", async () => {
    const { client, calls } = fakeClient([
      stage1Result(),
      stage2Result("hy3", 0.5),
    ])
    const engine = createDecisionEngine({
      client,
      pathOptions: PATH_OPTIONS,
      buildCandidates: () => CANDIDATES,
    })

    const result = await engine.decide(TASK)

    expect(result.source).toBe("fallback")
    expect(result.reason).toBe("low-confidence-stage2")
    expect(result.stage1).toBeDefined()
    expect(result.stage2).toBeDefined()
    expect(calls()).toBe(2)
  })

  it("no candidates -> fallback no-candidates", async () => {
    const { client, calls } = fakeClient([stage1Result()])
    const engine = createDecisionEngine({
      client,
      pathOptions: PATH_OPTIONS,
      buildCandidates: () => [],
    })

    const result = await engine.decide(TASK)

    expect(result.source).toBe("fallback")
    expect(result.reason).toBe("no-candidates")
    expect(result.stage1).toBeDefined()
    expect(calls()).toBe(1)
  })

  it("breaker opens after N failures and short-circuits without calling client", async () => {
    let n = 0
    const client: JevClient = {
      ask: async () => {
        n += 1
        throw new DecisionCoreError("jev-unavailable", "down")
      },
    }
    const engine = createDecisionEngine({
      client,
      pathOptions: PATH_OPTIONS,
      buildCandidates: () => CANDIDATES,
      breakerFailures: 3,
      breakerCooldownMs: 1000,
      now: () => 1000,
    })

    await engine.decide(TASK)
    await engine.decide(TASK)
    await engine.decide(TASK)
    const result = await engine.decide(TASK)

    expect(result.source).toBe("fallback")
    expect(result.reason).toBe("breaker-open")
    expect(n).toBe(3)
  })

  it("breaker re-closes after cooldown and calls client again", async () => {
    let nowVal = 1000
    let n = 0
    const client: JevClient = {
      ask: async () => {
        n += 1
        throw new DecisionCoreError("jev-unavailable", "down")
      },
    }
    const engine = createDecisionEngine({
      client,
      pathOptions: PATH_OPTIONS,
      buildCandidates: () => CANDIDATES,
      breakerFailures: 3,
      breakerCooldownMs: 1000,
      now: () => nowVal,
    })

    await engine.decide(TASK)
    await engine.decide(TASK)
    await engine.decide(TASK)
    nowVal = 3000
    await engine.decide(TASK)

    expect(n).toBe(4)
  })
})
