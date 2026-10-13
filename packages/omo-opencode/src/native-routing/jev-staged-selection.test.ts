import { describe, expect, test } from "bun:test"
import { createNativeJevBackend } from "./jev-adapter"
import { createNativeRouter } from "./router"
import type { NativeCandidate, NativeJevRequest, NativeLedgerRecord } from "./types"
import type { JevQuestionSet } from "@oh-my-opencode/decision-core"

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

  for (const stage of ["role", "group"] as const) test(`malformed ${stage} aborts before the next paid stage`, async () => {
    const { backend, calls } = fixture("worker", 255, undefined, stage)
    await expect(backend.choose(request(256))).rejects.toThrow(`malformed Jev ${stage} response`)
    expect(calls).toHaveLength(stage === "role" ? 1 : 2)
  })
})
