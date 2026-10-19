import { describe, expect, test } from "bun:test"
import { createNativeJevBackend, NativeJevRequestError } from "./jev-adapter"
import { createNativeRouter } from "./router"
import type { NativeCandidate, NativeJevRequest, NativeLedgerRecord } from "./types"
import { NativeJevAdmissionError, type JevQuestionSet } from "@oh-my-opencode/decision-core"

function request(models: number, roles = ["planner", "executor", "reviewer", "worker", "explore", "librarian", "research", "catalog-researcher"] as NativeCandidate["role"][]): NativeJevRequest {
  const candidates = roles.flatMap((role) => Array.from({ length: models }, (_, index): NativeCandidate => {
    const model = { providerID: "fixture", id: `model-${index}` }
    return { role, model, facts: { ...model, available: true, toolCall: true, inputPricePerMillion: index }, knowledge: { model, known: true, summary: `facts-${index}` } }
  }))
  return { decisionId: "boundary", input: { prompt: "boundary task", parentRole: roles.includes("planner") ? "orchestrator" : "planner", rootSessionID: "root", parentSessionID: "parent", kind: "task" }, allowedRoles: roles, candidates, knowledge: [], outcomes: [], instructions: "route" }
}

function fixture(preferredRole: string, target: number, lowStage?: string, malformedStage?: string) {
  const calls: { questions: JevQuestionSet; state: string }[] = []
  const backend = createNativeJevBackend({ session: "fixture", getApiKey: () => "fixture-key", maxAttempts: 1,
    postJson: async (_url, _headers, body) => {
      const payload = body as { questions: JevQuestionSet; state: string }
      calls.push(payload)
      const answers = Object.fromEntries(Object.entries(payload.questions).map(([name, question]) => {
        if (question.type !== "choice") throw new Error("expected choice")
        const entries = Object.entries(question.criteria)
        if (entries.length > 255) throw new Error(`Too many choices: ${entries.length}`)
        let choice = name === "role" ? preferredRole : name === "lane" ? ["planner", "executor", "reviewer"].includes(preferredRole) ? "department" : "direct" : `worker|fixture/model-${target}`
        if (name === "candidate") choice = `${preferredRole}|fixture/model-${target}`
        if (name === "group") choice = entries.find(([, value]) => (JSON.parse(value) as { model: { id: string } }[]).some((item) => item.model.id === `model-${target}`))?.[0] ?? ""
        if (name === malformedStage) choice = "outside-eligible-set"
        return [name, { type: "choice", choice, confidence: name === lowStage ? 0.2 : 0.99, probabilities: { [choice]: 1 } }]
      }))
      return { status: 200, body: { answers, usage: { input_tokens: 100, output_tokens: 5 } } }
    },
  })
  return { backend, calls }
}

describe("Jev choice boundary", () => {
  for (const [models, roles, selectedRole] of [
    [53, undefined, "worker"],
    [53, ["worker", "explore", "librarian", "research", "catalog-researcher"], "worker"],
    [53, undefined, "planner"],
    [256, ["worker"], "worker"],
    [65_026, ["worker"], "worker"],
  ] as const) {
    test(`preserves ${models} eligible models for ${selectedRole} with bounded real transport questions`, async () => {
      const input = request(models, roles ? [...roles] : undefined)
      const target = models > 65_025 ? 0 : models - 1
      const { backend, calls } = fixture(selectedRole, target)
      const answer = await backend.choose(input)
      expect(answer.model.id).toBe(`model-${target}`)
      expect(answer.role).toBe(selectedRole)
      expect(answer.lane).toBe(selectedRole === "planner" ? "department" : "direct")
      expect(answer.usage?.inputTokens).toBe(calls.length * 100)
      expect(answer.usage?.costUsd).toBeCloseTo(calls.length * 0.0000042)
      const firstModelStage = calls.find((call) => call.questions.group || call.questions.candidate)!
      const criteria = firstModelStage.questions.group ?? firstModelStage.questions.candidate!
      if (criteria.type !== "choice") throw new Error("expected choices")
      const delivered = Object.values(criteria.criteria).flatMap((value) => {
        const parsed = JSON.parse(value) as unknown
        return Array.isArray(parsed) ? parsed : [parsed]
      })
      expect(delivered).toHaveLength(models)
      expect(new Set(delivered.map((item) => item.model.id)).size).toBe(models)
      expect(delivered.at(-1).knowledge.summary).toBe(`facts-${models - 1}`)
    })
  }

  test("weak role confidence remains explicit caller selection with full eligibility recorded", async () => {
    const input = request(53)
    const { backend } = fixture("worker", 52, "role")
    const rows: NativeLedgerRecord[] = []
    const router = createNativeRouter({ jev: backend, catalog: { listAvailable: () => input.candidates.filter((candidate) => candidate.role === "worker").map((candidate) => candidate.facts) }, pool: { isAllowed: () => true }, knowledge: { get: (model) => ({ model, known: true }) }, outcomes: { list: () => [] }, store: { load: async () => [], append: async (row) => { rows.push(row) }, exportLines: async () => rows.map((row) => JSON.stringify(row)) } })
    const result = await router.route(input.input)
    expect(result.kind).toBe("awaiting_selection")
    if (result.kind !== "awaiting_selection") throw new Error("expected caller selection")
    expect(result.candidates.length).toBeGreaterThan(0)
    const decision = rows.find((row) => row.type === "decision")
    expect(decision?.type === "decision" ? decision.request.candidates.length : 0).toBe(424)
    expect(result.reason).toContain("confidence")
  })

  test("second-stage admission denial preserves first-stage input billing without retry", async () => {
    let guards = 0
    let http = 0
    const backend = createNativeJevBackend({ session: "fixture", getApiKey: () => "fixture", maxAttempts: 5, beforeRequest: () => { guards += 1; if (guards > 1) throw new NativeJevAdmissionError("fixture integration became inactive") }, postJson: async () => { http += 1; return { status: 200, body: { answers: { role: { type: "choice", choice: "worker", confidence: 1, probabilities: { worker: 1 } }, lane: { type: "choice", choice: "direct", confidence: 1, probabilities: { direct: 1 } } }, usage: { input_tokens: 13, output_tokens: 5 } } } } })
    let failure: unknown
    try { await backend.choose(request(53)) } catch (error) { failure = error }
    if (!(failure instanceof NativeJevRequestError)) throw new Error("Expected native audit error")
    expect(failure.notSent).toBe(false)
    expect(failure.admissionDenied).toBe(true)
    expect(failure.attempts).toHaveLength(1)
    expect(failure.usage?.inputTokens).toBe(13)
    expect(failure.usage?.costUsd).toBe(13 * 0.042 / 1_000_000)
    expect(guards).toBe(2)
    expect(http).toBe(1)
  })

  for (const lost of ["transport", "http"] as const) test(`later ${lost} attempt without receipt keeps total cost unknown`, async () => {
    let http = 0
    const backend = createNativeJevBackend({ session: "fixture", getApiKey: () => "fixture", maxAttempts: 1, postJson: async () => {
      http += 1
      if (http > 1) {
        if (lost === "transport") throw new Error("fixture response lost after send")
        return { status: 400, body: { error: "fixture missing receipt" } }
      }
      return { status: 200, body: { answers: { role: { type: "choice", choice: "worker", confidence: 1, probabilities: { worker: 1 } }, lane: { type: "choice", choice: "direct", confidence: 1, probabilities: { direct: 1 } } }, usage: { input_tokens: 13, output_tokens: 5 } } }
    } })
    let failure: unknown
    try { await backend.choose(request(53)) } catch (error) { failure = error }
    if (!(failure instanceof NativeJevRequestError)) throw new Error("Expected audited error")
    expect(failure.notSent).toBe(false)
    expect(failure.attempts).toHaveLength(2)
    expect(failure.usage?.inputTokens).toBe(13)
    expect(failure.usage?.outputTokens).toBe(5)
    expect(failure.usage?.costUsd).toBeUndefined()
  })

  test("HTTP usage survives decoder failure without accepting malformed selection", async () => {
    const backend = createNativeJevBackend({ session: "fixture", getApiKey: () => "fixture-key", maxAttempts: 1, postJson: async () => ({ status: 200, body: { answers: { candidate: null }, usage: { input_tokens: 123, output_tokens: 4 } } }) })
    let failure: unknown
    try { await backend.choose(request(1, ["worker"])) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(NativeJevRequestError)
    if (!(failure instanceof NativeJevRequestError)) throw new Error("expected decoder failure")
    expect(failure.usage?.inputTokens).toBe(123)
    expect(failure.usage?.outputTokens).toBe(4)
    expect(failure.usage?.costUsd).toBeCloseTo(123 * 0.042 / 1_000_000)
  })

  test("only reported input tokens determine Jev cost regardless of output size", async () => {
    const costs: number[] = []
    for (const outputTokens of [1, 100_000_000]) {
      const backend = createNativeJevBackend({ session: "fixture", getApiKey: () => "fixture-key", maxAttempts: 1, postJson: async () => ({ status: 200, body: { answers: { candidate: { type: "choice", choice: "worker|fixture/model-0", confidence: 1, probabilities: { "worker|fixture/model-0": 1 } }, lane: { type: "choice", choice: "direct", confidence: 1, probabilities: { direct: 1 } } }, usage: { input_tokens: 123, output_tokens: outputTokens } } }) })
      const selected = await backend.choose(request(1, ["worker"]))
      expect(selected.usage?.outputTokens).toBe(outputTokens)
      expect(selected.usage?.costUsd).toBe(123 * 0.042 / 1_000_000)
      costs.push(selected.usage!.costUsd!)
    }
    expect(costs[0]).toBe(costs[1])
  })

  test("partial error response usage keeps unreported input and price unknown", async () => {
    const backend = createNativeJevBackend({ session: "fixture", getApiKey: () => "fixture-key", maxAttempts: 1, postJson: async () => ({ status: 400, body: { error: "fixture", usage: { output_tokens: 4 } } }) })
    let failure: unknown
    try { await backend.choose(request(1, ["worker"])) } catch (error) { failure = error }
    if (!(failure instanceof NativeJevRequestError)) throw new Error("Expected audited failure")
    expect(failure.usage?.inputTokens).toBeUndefined()
    expect(failure.usage?.outputTokens).toBe(4)
    expect(failure.usage?.costUsd).toBeUndefined()
  })

  test("unknown HTTP usage never becomes an invented zero bill", async () => {
    const backend = createNativeJevBackend({ session: "fixture", getApiKey: () => "fixture-key", maxAttempts: 1, postJson: async () => ({ status: 200, body: { answers: { candidate: { type: "choice", choice: "worker|fixture/model-0", confidence: 1, probabilities: { "worker|fixture/model-0": 1 } }, lane: { type: "choice", choice: "direct", confidence: 1, probabilities: { direct: 1 } } } } }) })
    const selected = await backend.choose(request(1, ["worker"]))
    expect(selected.usage?.costUsd).toBeUndefined()
    expect(selected.usage?.inputTokens).toBeUndefined()
    expect(selected.usage?.outputTokens).toBeUndefined()
  })

  test("retains paid usage when a later stage returns malformed selection", async () => {
    const { backend, calls } = fixture("worker", 255, undefined, "group")
    let failure: unknown
    try { await backend.choose(request(256)) } catch (error) { failure = error }
    expect(failure).toBeInstanceOf(NativeJevRequestError)
    if (!(failure instanceof NativeJevRequestError)) throw new Error("expected audited failure")
    expect(failure.usage?.inputTokens).toBe(200)
    expect(failure.usage?.costUsd).toBeCloseTo(0.0000084)
    expect(calls.every((call) => !Object.hasOwn(JSON.parse(call.state), "candidates"))).toBe(true)
  })

  for (const stage of ["role", "group"] as const) test(`malformed ${stage} aborts before the next paid stage`, async () => {
    const { backend, calls } = fixture("worker", 255, undefined, stage)
    await expect(backend.choose(request(256))).rejects.toThrow(`malformed Jev ${stage} response`)
    expect(calls).toHaveLength(stage === "role" ? 1 : 2)
  })
})

test("final model criteria retain bounded published model evidence without duplicating source prices", async () => {
  const { candidateCriteria } = await import("./jev-staged-selection")
  const candidate = request(1, ["worker"]).candidates[0]!
  const enriched: NativeCandidate = { ...candidate, facts: {
    ...candidate.facts,
    displayName: "SDK display name", family: "SDK family", canonical: "provider/canonical", inputModalities: ["text", "image"], outputModalities: ["text"],
    published: { source: "https://models.dev/api.json", name: "Published name", description: "d".repeat(2000), family: "Published family", reasoning: true },
  } }
  const criteria = JSON.parse(Object.values(candidateCriteria([enriched]))[0]!)
  expect(criteria).toMatchObject({ displayName: "SDK display name", family: "SDK family", canonical: "provider/canonical", published: { source: "https://models.dev/api.json", name: "Published name", family: "Published family", reasoning: true }, pricesPerMillion: { input: 0, output: "unknown" } })
  expect(criteria.inputModalities).toEqual(["text", "image"])
  expect(criteria.outputModalities).toEqual(["text"])
  expect(criteria.published.description).toHaveLength(1600)
  expect(Object.keys(criteria.published).sort()).toEqual(["description", "family", "name", "reasoning", "source"])
  const untrusted = { ...enriched, facts: { ...enriched.facts, published: { source: "unverified", description: "unsupported" } } }
  expect(JSON.parse(Object.values(candidateCriteria([untrusted]))[0]!).published).toBeUndefined()
})
