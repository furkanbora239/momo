import { describe, test, expect } from "bun:test"
import { createDecisionRouter } from "./decision-router"
import { ManagerConfigSchema } from "../../config/schema/decision-engine"
import type { DecisionEngine, DecisionResult, ModelCandidate } from "@oh-my-opencode/decision-core"
import type { DecisionLedger } from "../../features/decision-ledger/ledger"

const managerConfig = ManagerConfigSchema.parse({})

function baseJevResult(): DecisionResult {
  return {
    source: "jev",
    stage1: {
      path: { type: "choice", choice: "quick", confidence: 0.9, probabilities: {} },
      effort: { type: "score", score: 2, confidence: 0.9 },
    },
    candidates: [{ name: "a/b", priceLine: "$0.04/M input", strength: "fast" }],
    stage2: {
      model: { type: "choice", choice: "a/b", confidence: 0.9, probabilities: {} },
      lane: { type: "choice", choice: "direct-worker", confidence: 0.9, probabilities: {} },
    },
    resolved: { path: "quick", effort: 2, model: "a/b", lane: "direct-worker" },
    usage: { inputTokens: 100, costUsd: 0.0042 },
    latencyMs: 50,
  }
}

function jevResultFor(path: string, model = "a/b", lane = "direct-worker"): DecisionResult {
  const result = baseJevResult()
  result.stage1 = {
    path: { type: "choice", choice: path, confidence: 0.9, probabilities: {} },
    effort: { type: "score", score: 2, confidence: 0.9 },
  }
  result.resolved = { path, effort: 2, model, lane }
  return result
}

function mockEngine(result: DecisionResult | Error): DecisionEngine & { calls: number } {
  const engine = {
    calls: 0,
    async decide() {
      engine.calls += 1
      if (result instanceof Error) throw result
      return result
    },
  }
  return engine
}

function mockLedger(monthlySpend = 0) {
  const records: unknown[] = []
  const backfills: unknown[] = []
  const ledger = {
    record: (entry: unknown) => {
      records.push(entry)
      return { id: `id-${records.length}`, ts: Date.now() }
    },
    backfillOutcome: (outcome: unknown) => {
      backfills.push(outcome)
      return true
    },
    accumulate: () => {},
    monthlySpendUsd: () => monthlySpend,
    readAll: () => [],
  } as unknown as DecisionLedger
  return { ledger, records, backfills }
}

const candidates: readonly ModelCandidate[] = [
  { name: "cheap/x", priceLine: "$0.04/M input", strength: "budget" },
  { name: "pricey/y", priceLine: "$4/M input", strength: "premium" },
]

describe("createDecisionRouter - path to rewrite mapping", () => {
  const cases: Array<[string, "category" | "subagent_type", string]> = [
    ["quick", "category", "quick"],
    ["explore", "subagent_type", "explore"],
    ["librarian", "subagent_type", "librarian"],
    ["research", "subagent_type", "research"],
    ["planner", "subagent_type", "planner"],
    ["executor", "subagent_type", "executor"],
    ["reviewer", "subagent_type", "reviewer"],
  ]

  for (const [path, kind, value] of cases) {
    test(`#given jev resolves path "${path}" #when route called #then rewrites to ${kind} "${value}"`, async () => {
      const engine = mockEngine(jevResultFor(path))
      const { ledger } = mockLedger()
      const router = createDecisionRouter({
        client: {} as never,
        config: managerConfig,
        ledger,
        engine,
        buildCandidatesImpl: () => candidates,
      })

      const result = await router.route({ description: "task", prompt: "do the thing" })

      expect(result.source).toBe("jev")
      expect(result.rewrite[kind]).toBe(value)
    })
  }
})

describe("createDecisionRouter - model override and lane", () => {
  test("#given jev resolves a model #when route called #then model override is set on the rewrite", async () => {
    const engine = mockEngine(jevResultFor("explore", "neuralwatt/kimi-k3"))
    const { ledger } = mockLedger()
    const router = createDecisionRouter({
      client: {} as never,
      config: managerConfig,
      ledger,
      engine,
      buildCandidatesImpl: () => candidates,
    })

    const result = await router.route({ description: "t", prompt: "p" })

    expect(result.rewrite.subagent_type).toBe("explore")
    expect(result.rewrite.model).toBe("neuralwatt/kimi-k3")
  })

  test("#given lane department with planner path #when route called #then lead path kept with model as lead model", async () => {
    const engine = mockEngine(jevResultFor("planner", "neuralwatt/glm", "department"))
    const { ledger } = mockLedger()
    const router = createDecisionRouter({
      client: {} as never,
      config: managerConfig,
      ledger,
      engine,
      buildCandidatesImpl: () => candidates,
    })

    const result = await router.route({ description: "t", prompt: "p" })

    expect(result.rewrite.subagent_type).toBe("planner")
    expect(result.rewrite.model).toBe("neuralwatt/glm")
  })
})

describe("createDecisionRouter - fallback ladder", () => {
  test("#given engine returns fallback #when route called #then deterministic deep default with reason", async () => {
    const fallback: DecisionResult = {
      ...baseJevResult(),
      source: "fallback",
      reason: "low-confidence-stage1",
      resolved: {},
    }
    const engine = mockEngine(fallback)
    const { ledger } = mockLedger()
    const router = createDecisionRouter({
      client: {} as never,
      config: managerConfig,
      ledger,
      engine,
      buildCandidatesImpl: () => candidates,
    })

    const result = await router.route({ description: "t", prompt: "p" })

    expect(result.source).toBe("fallback")
    expect(result.reason).toBe("low-confidence-stage1")
    expect(result.rewrite).toEqual({ category: "deep" })
  })

  test("#given monthly spend at cap #when route called #then budget-cap fallback without calling engine", async () => {
    const engine = mockEngine(jevResultFor("quick"))
    const { ledger } = mockLedger(managerConfig.jev.budget.monthly_cap_usd + 1)
    const router = createDecisionRouter({
      client: {} as never,
      config: managerConfig,
      ledger,
      engine,
      buildCandidatesImpl: () => candidates,
    })

    const result = await router.route({ description: "t", prompt: "p" })

    expect(engine.calls).toBe(0)
    expect(result.reason).toBe("budget-cap")
    expect(result.rewrite).toEqual({ category: "deep" })
  })

  test("#given engine throws #when route called #then never throws, returns deep default", async () => {
    const engine = mockEngine(new Error("jev down"))
    const { ledger } = mockLedger()
    const router = createDecisionRouter({
      client: {} as never,
      config: managerConfig,
      ledger,
      engine,
      buildCandidatesImpl: () => candidates,
    })

    const result = await router.route({ description: "t", prompt: "p" })

    expect(result.source).toBe("fallback")
    expect(result.reason).toBe("jev-error")
    expect(result.rewrite).toEqual({ category: "deep" })
  })
})

describe("createDecisionRouter - ledger integration", () => {
  test("#given jev decision #when route called #then record is called with full entry and decisionId returned", async () => {
    const engine = mockEngine(jevResultFor("executor", "a/b"))
    const { ledger, records } = mockLedger()
    const router = createDecisionRouter({
      client: {} as never,
      config: managerConfig,
      ledger,
      engine,
      buildCandidatesImpl: () => candidates,
    })

    const result = await router.route({ description: "build it", prompt: "implement the feature" })

    expect(result.decisionId).toBeDefined()
    expect(records).toHaveLength(1)
    const entry = records[0] as Record<string, unknown>
    expect(entry.session).toBe("momo-decision-router")
    expect(entry.source).toBe("jev")
    expect(entry.resolved).toEqual({ path: "executor", effort: 2, model: "a/b", lane: "direct-worker" })
    expect((entry.task as Record<string, unknown>).description).toBe("build it")
    expect(Array.isArray(entry.candidates)).toBe(true)
  })

  test("#given recorded decision #when backfill called #then ledger.backfillOutcome receives decisionId", async () => {
    const engine = mockEngine(jevResultFor("quick"))
    const { ledger, backfills } = mockLedger()
    const router = createDecisionRouter({
      client: {} as never,
      config: managerConfig,
      ledger,
      engine,
      buildCandidatesImpl: () => candidates,
    })

    const result = await router.route({ description: "t", prompt: "p" })
    router.backfill(result.decisionId, { status: "success", durationMs: 123 })

    expect(backfills).toHaveLength(1)
    const outcome = backfills[0] as Record<string, unknown>
    expect(outcome.decisionId).toBe(result.decisionId)
    expect(outcome.status).toBe("success")
    expect(outcome.durationMs).toBe(123)
  })

  test("#given ledger.record throws #when route called #then dispatch still succeeds with undefined decisionId", async () => {
    const engine = mockEngine(jevResultFor("quick"))
    const failingLedger = {
      ...mockLedger().ledger,
      record: () => {
        throw new Error("disk full")
      },
    } as unknown as DecisionLedger
    const router = createDecisionRouter({
      client: {} as never,
      config: managerConfig,
      ledger: failingLedger,
      engine,
      buildCandidatesImpl: () => candidates,
    })

    const result = await router.route({ description: "t", prompt: "p" })

    expect(result.rewrite).toEqual({ category: "quick", model: "a/b" })
    expect(result.decisionId).toBeUndefined()
  })
})
