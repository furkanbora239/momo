import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createJsonlNativeRouterStore } from "./jsonl-store"
import { createNativeJevAdapter } from "./jev-adapter"
import { createNativeJevBackend, nativeJevFailureEvidence } from "./jev-adapter"
import { createNativeRouter } from "./router"
import { createNativeJevAccountant } from "./jev-accountant"
import { NativeJevAdmissionError, type JevCallResult, type JevClient, type JevQuestionSet } from "@oh-my-opencode/decision-core"
import type {
  NativeDecisionRecord,
  NativeJevAnswer,
  NativeLedgerRecord,
  NativeModelFacts,
  NativeModelRef,
  NativeRouteInput,
  NativeRouterDeps,
  NativeRouterStore,
} from "./types"

const tempDirs: string[] = []
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function memoryStore(initial: readonly NativeLedgerRecord[] = []): NativeRouterStore {
  const rows = [...initial]
  return {
    async load() { return [...rows] },
    async append(record) { rows.push(record) },
    async exportLines() { return rows.map((row) => JSON.stringify(row)) },
  }
}

const model = (id: string, extra: Partial<NativeModelFacts> = {}): NativeModelFacts => ({
  providerID: "connected-provider",
  id,
  available: true,
  ...extra,
})

const input = (overrides: Partial<NativeRouteInput> = {}): NativeRouteInput => ({
  prompt: "complete original task prompt with all constraints",
  scope: "packages/demo",
  acceptance: "the relevant behavior works",
  parentRole: "orchestrator",
  rootSessionID: "root-1",
  parentSessionID: "parent-1",
  kind: "task",
  ...overrides,
})

function answer(role: string, selected: NativeModelRef, confidence = 0.95, probabilities?: Record<string, number>): NativeJevAnswer {
  return {
    role,
    model: selected,
    confidence,
    lane: role === "planner" || role === "executor" || role === "reviewer" ? "department" : "direct",
    probabilities: probabilities ?? { [`${role}|${selected.providerID}/${selected.id}`]: 1 },
  }
}

function deps(options: {
  models?: NativeModelFacts[]
  choose?: NativeRouterDeps["jev"]["choose"]
  store?: NativeRouterStore
  allowed?: (model: NativeModelRef) => boolean
  advisorModels?: readonly NativeModelRef[]
  getAdvisorModels?: () => readonly NativeModelRef[]
  knowledge?: NativeRouterDeps["knowledge"]
} = {}): NativeRouterDeps {
  const models = options.models ?? [model("free", { inputPricePerMillion: 0, outputPricePerMillion: 0 })]
  return {
    jev: { choose: options.choose ?? (async () => answer("worker", models[0]!)) },
    catalog: { listAvailable: () => models },
    pool: { isAllowed: options.allowed ?? (() => true) },
    knowledge: options.knowledge ?? { get: () => undefined },
    outcomes: { list: () => [] },
    store: options.store ?? memoryStore(),
    config: { createId: (() => { let id = 0; return () => `decision-${++id}` })(), advisorModels: options.advisorModels, getAdvisorModels: options.getAdvisorModels },
  }
}

describe("native task routing", () => {
  test("corrupt active ledger prevents Jev replay after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "momo-native-ledger-corrupt-"))
    tempDirs.push(root)
    const path = join(root, "routing-ledger.jsonl")
    await writeFile(path, '{"version":1,"type":"decision","decisionId":"stable","status":"awaiting_selection"}\n', "utf8")
    let calls = 0
    const router = createNativeRouter(deps({
      store: createJsonlNativeRouterStore(path),
      choose: async () => { calls += 1; return answer("worker", model("free")) },
    }))

    await expect(router.route(input({ decisionId: "stable" }))).rejects.toThrow("corrupt active ledger")
    expect(calls).toBe(0)
  })

  test("sends the complete task and the full real catalog to Jev without a six-model cap", async () => {
    const models = Array.from({ length: 8 }, (_, index) => model(`model-${index}`, {
      inputPricePerMillion: index === 0 ? 0 : undefined,
      outputPricePerMillion: index === 0 ? 0 : undefined,
      contextLength: index === 2 ? 128_000 : undefined,
    }))
    let captured: Parameters<NonNullable<NativeRouterDeps["jev"]>["choose"]>[0] | undefined
    const router = createNativeRouter(deps({ models, choose: async (request) => {
      captured = request
      return answer("worker", models[0]!)
    } }))

    const result = await router.route(input())

    expect(result.kind).toBe("selected")
    expect(captured?.input).toEqual({ ...input(), decisionId: "decision-1" })
    expect(captured?.candidates).toHaveLength(8 * 8)
    expect(captured?.candidates.some((candidate) => candidate.facts.inputPricePerMillion === undefined)).toBe(true)
    expect(captured?.candidates.some((candidate) => candidate.knowledge.known === false)).toBe(true)
    expect(captured?.outcomes).toEqual([])
  })

  test("restricts department children to worker roles", async () => {
    let roles: string[] = []
    const router = createNativeRouter(deps({ choose: async (request) => {
      roles = [...new Set(request.candidates.map((candidate) => candidate.role))]
      return answer("worker", model("free"))
    } }))

    await router.route(input({ parentRole: "planner", parentSessionID: "planner-session" }))

    expect(roles).toEqual(["worker", "explore", "librarian", "research", "catalog-researcher"])
  })

  test("intersects internal required-role routing with the caller's allowed roles", async () => {
    let roles: string[] = []
    const router = createNativeRouter(deps({ choose: async (request) => {
      roles = [...new Set(request.candidates.map((candidate) => candidate.role))]
      return answer("catalog-researcher", model("free"))
    } }))

    const result = await router.route(input({ requiredRole: "catalog-researcher" }))

    expect(result.kind).toBe("selected")
    expect(roles).toEqual(["catalog-researcher"])
  })

  test("keeps an empty advisor pool disabled for consultations", async () => {
    let jevCalled = false
    const router = createNativeRouter(deps({ choose: async () => { jevCalled = true; return answer("advisor", model("free")) } }))

    const result = await router.route(input({ kind: "consultation" }))

    expect(result.kind).toBe("unavailable")
    expect(jevCalled).toBe(false)
  })

  test("returns all eligible options after Jev failure and selection never calls Jev again", async () => {
    const models = [model("free"), model("paid")]
    let calls = 0
    const router = createNativeRouter(deps({ models, choose: async () => { calls += 1; throw new Error("offline") } }))
    const result = await router.route(input())
    expect(result.kind).toBe("awaiting_selection")
    if (result.kind !== "awaiting_selection") throw new Error("expected selection ticket")
    expect(result.candidates).toHaveLength(16)
    const selected = await router.select(result.decisionId, models[1]!, "worker", "parent-1")

    expect(selected).toMatchObject({ kind: "selected", model: { providerID: models[1]!.providerID, id: models[1]!.id } })
    expect(calls).toBe(1)
  })

  test("rejects selection by another session and refreshes options when the pool changes", async () => {
    const models = [model("free"), model("paid")]
    let calls = 0
    let paidAllowed = true
    const router = createNativeRouter(deps({
      models,
      allowed: (ref) => ref.id !== "paid" || paidAllowed,
      choose: async () => { calls += 1; throw new Error("offline") },
    }))
    const result = await router.route(input())
    if (result.kind !== "awaiting_selection") throw new Error("expected selection ticket")

    const unauthorized = await router.select(result.decisionId, models[0]!, "worker", "different-session")
    expect(unauthorized).toMatchObject({ kind: "unavailable" })
    paidAllowed = false
    const stale = await router.select(result.decisionId, models[1]!, "worker", "parent-1")

    expect(stale.kind).toBe("awaiting_selection")
    if (stale.kind === "awaiting_selection") expect(stale.candidates.every((candidate) => candidate.model.id === "free")).toBe(true)
    expect(calls).toBe(1)
  })

  test("limits consultation to the configured advisor pool intersected with the general pool", async () => {
    const models = [model("advisor"), model("other")]
    let roles: string[] = []
    const router = createNativeRouter(deps({
      models,
      advisorModels: [{ providerID: "connected-provider", id: "advisor" }, { providerID: "connected-provider", id: "offline" }],
      choose: async (request) => {
        roles = [...new Set(request.candidates.map((candidate) => candidate.role))]
        return answer("advisor", models[0]!)
      },
    }))

    const result = await router.route(input({ kind: "consultation" }))

    expect(result).toMatchObject({ kind: "selected", role: "advisor", model: { providerID: models[0]!.providerID, id: models[0]!.id } })
    expect(roles).toEqual(["advisor"])
    const disabled = createNativeRouter(deps({ models, choose: async () => { throw new Error("must not run") } }))
    expect(await disabled.route(input({ kind: "consultation" }))).toMatchObject({ kind: "unavailable" })
  })

  test("reads advisor pool changes for each consultation and persists empty-pool rejections", async () => {
    const models = [model("advisor")]
    let enabled = false
    const store = memoryStore()
    let calls = 0
    const router = createNativeRouter({
      ...deps({ models, choose: async () => { calls += 1; return answer("advisor", models[0]!) } }),
      store,
      config: { getAdvisorModels: () => enabled ? [models[0]!] : [] },
    })
    const first = await router.route(input({ decisionId: "consult-1", kind: "consultation" }))
    enabled = true
    const second = await router.route(input({ decisionId: "consult-2", kind: "consultation" }))

    expect(first).toMatchObject({ kind: "unavailable", decisionId: "consult-1" })
    expect(second).toMatchObject({ kind: "selected", decisionId: "consult-2" })
    expect(calls).toBe(1)
    const lines = await store.exportLines()
    expect(JSON.parse(lines[0]!).status).toBe("unavailable")
    expect(JSON.parse(lines[0]!).request.input.kind).toBe("consultation")
  })

  test("queues missing knowledge with root provenance without blocking or repeating the same model research", async () => {
    const selected = model("free")
    let releaseResearch: (() => void) | undefined
    let announceResearch: (() => void) | undefined
    const researchStarted = new Promise<void>((resolve) => { announceResearch = resolve })
    const researchPending = new Promise<void>((resolve) => { releaseResearch = resolve })
    const contexts: unknown[] = []
    const router = createNativeRouter(deps({
      models: [selected],
      knowledge: {
        get: () => ({ model: selected, known: false }),
        research: (_model, context) => { contexts.push(context); announceResearch?.(); return researchPending },
      },
    }))

    const first = await router.route(input({ decisionId: "research-1" }))
    expect(contexts).toHaveLength(0)
    await router.recordDispatch("research-1", { taskId: "task-1", sessionId: "session-1", role: "worker", model: selected }, "parent-1")
    await researchStarted
    const second = await router.route(input({ decisionId: "research-2" }))
    releaseResearch?.()

    expect(first.kind).toBe("selected")
    expect(second.kind).toBe("selected")
    expect(contexts).toEqual([{
      decisionId: "research-1", rootSessionID: "root-1", parentSessionID: "parent-1", parentRole: "orchestrator",
    }])
  })

  test("restart repairs a saved dispatched research enqueue gap without fanout or unused selections", async () => {
    const models = Array.from({ length: 53 }, (_, index) => model(`m${index}`))
    const store = memoryStore()
    let release: (() => void) | undefined
    const stalledEnqueue = new Promise<void>((resolve) => { release = resolve })
    const original = createNativeRouter(deps({ models, store, knowledge: { get: () => undefined, research: () => stalledEnqueue } }))
    const selected = await original.route(input({ decisionId: "dispatched" }))
    if (selected.kind !== "selected") throw new Error("fixture selection failed")
    await original.recordDispatch("dispatched", { taskId: "task", sessionId: "session", role: "worker", model: selected.model }, "parent-1")
    await original.route(input({ decisionId: "unused-selection" }))
    const observed: Array<{ model: NativeModelRef; context: unknown }> = []
    let jevCalls = 0
    const restarted = createNativeRouter(deps({ models, store, choose: async () => { jevCalls++; return answer("worker", models[0]!) }, knowledge: {
      get: () => undefined, research: async (model, context) => { observed.push({ model, context }) },
    } }))
    await restarted.recoverResearch(); await restarted.recoverResearch()
    release?.()
    expect(observed).toEqual([{ model: { providerID: models[0]!.providerID, id: "m0" }, context: { decisionId: "dispatched", rootSessionID: "root-1", parentSessionID: "parent-1", parentRole: "orchestrator" } }])
    expect(jevCalls).toBe(0)
  })

  test("53 unknown snapshot models create no research until actual dispatch; explicit research avoids Jev and revalidates its pool", async () => {
    const models = Array.from({ length: 53 }, (_, index) => model(`m${index}`))
    const researched: string[] = []
    let calls = 0
    let allowed = true
    const store = memoryStore()
    const router = createNativeRouter(deps({ models, store, allowed: () => allowed,
      choose: async () => { calls++; return answer("worker", models[0]!) },
      knowledge: { get: () => undefined, research: async (item) => { researched.push(item.id) } },
    }))
    await router.route(input({ decisionId: "origin", parentSessionID: "root-1" }))
    expect(researched).toHaveLength(0)
    await router.recordDispatch("origin", { taskId: "used", sessionId: "used-session", role: "worker", model: models[0]! }, "root-1")
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(researched).toEqual(["m0"])
    const brief = input({ decisionId: "maintenance", sourceDecisionID: "origin", parentSessionID: "root-1", requiredRole: "catalog-researcher" })
    expect((await router.bindResearch(brief, models[1]!)).kind).toBe("selected")
    expect(calls).toBe(1)
    allowed = false
    expect((await router.revalidateSelected("maintenance", "root-1")).kind).toBe("unavailable")
    expect(calls).toBe(1)
    expect((await router.bindResearch({ ...brief, decisionId: "forged", sourceDecisionID: "missing" }, models[1]!)).kind).toBe("unavailable")
  })

  test("returns at most three probability-ranked options when Jev confidence is low", async () => {
    const models = [model("m0"), model("m1"), model("m2"), model("m3")]
    const probabilities = Object.fromEntries(models.map((item, index) => [`worker|${item.providerID}/${item.id}`, [0.4, 0.3, 0.2, 0.1][index]!]))
    const router = createNativeRouter(deps({ models, choose: async () => answer("worker", models[0]!, 0.4, probabilities) }))

    const result = await router.route(input())

    expect(result.kind).toBe("awaiting_selection")
    if (result.kind === "awaiting_selection") {
      expect(result.candidates).toHaveLength(3)
      expect(result.candidates.map((candidate) => candidate.model.id)).toEqual(["m0", "m1", "m2"])
    }
  })

  test("manual selection is restricted to presented low-confidence choices and refreshes without another Jev call", async () => {
    const models = [model("m0"), model("m1"), model("m2"), model("m3")]
    const probabilities = Object.fromEntries(models.map((item, index) => [`worker|${item.providerID}/${item.id}`, [0.4, 0.3, 0.2, 0.1][index]!]))
    let calls = 0
    const router = createNativeRouter(deps({ models, choose: async () => {
      calls += 1
      return answer("worker", models[0]!, 0.4, probabilities)
    } }))

    const pending = await router.route(input())
    if (pending.kind !== "awaiting_selection") throw new Error("expected low-confidence selection ticket")
    const rejected = await router.select(pending.decisionId, models[3]!, "worker", "parent-1")

    expect(rejected.kind).toBe("awaiting_selection")
    if (rejected.kind === "awaiting_selection") {
      expect(rejected.decisionId).toBe(pending.decisionId)
      expect(rejected.candidates.map((candidate) => candidate.model.id)).toEqual(["m0", "m1", "m2"])
    }
    expect(calls).toBe(1)

    const selected = await router.select(pending.decisionId, models[2]!, "worker", "parent-1")
    expect(selected).toMatchObject({ kind: "selected", decisionId: pending.decisionId, role: "worker", model: { providerID: models[2]!.providerID, id: models[2]!.id } })
    expect(calls).toBe(1)
  })

  test("does not dispatch a role that conflicts with Jev's actual lane answer", async () => {
    const router = createNativeRouter(deps({ choose: async () => ({
      ...answer("planner", model("free")),
      lane: "direct",
    }) }))

    const result = await router.route(input())

    expect(result.kind).toBe("awaiting_selection")
    if (result.kind === "awaiting_selection") expect(result.reason).toContain("ineligible")
  })

  test("requires lane confidence and revalidates Jev's choice against the latest pool", async () => {
    const selected = model("free")
    let allowed = true
    const router = createNativeRouter(deps({
      models: [selected, model("backup")],
      allowed: (ref) => ref.id !== "free" || allowed,
      choose: async () => {
        allowed = false
        return { ...answer("worker", selected), laneConfidence: 0.2 }
      },
    }))
    const result = await router.route(input())
    expect(result.kind).toBe("awaiting_selection")
    if (result.kind === "awaiting_selection") {
      expect(result.candidates.some((candidate) => candidate.model.id === "free")).toBe(false)
    }
  })

  test("persists the exact Jev input request while recording refreshed choices separately", async () => {
    const rows: NativeLedgerRecord[] = []
    const store: NativeRouterStore = {
      async load() { return [...rows] },
      async append(record) { rows.push(record) },
      async exportLines() { return rows.map((row) => JSON.stringify(row)) },
    }
    const original = model("free")
    const router = createNativeRouter(deps({
      store,
      models: [original, model("backup")],
      choose: async (request) => {
        expect(request.candidates.some((candidate) => candidate.model.id === "free")).toBe(true)
        return { ...answer("worker", original), confidence: 0.3 }
      },
    }))
    const result = await router.route(input())
    expect(result.kind).toBe("awaiting_selection")
    const ticket = rows.filter((row) => row.type === "decision").at(-1)
    if (!ticket || ticket.type !== "decision") throw new Error("expected persisted decision")
    expect(ticket.request.candidates.some((candidate) => candidate.model.id === "free")).toBe(true)
    expect(ticket.candidateSnapshots.at(-1)?.source).toBe("post-jev-revalidation")
  })

  test("revalidates a selected route immediately before runtime dispatch", async () => {
    let paidAllowed = true
    const models = [model("free"), model("paid")]
    const router = createNativeRouter(deps({
      models,
      allowed: (ref) => ref.id !== "paid" || paidAllowed,
      choose: async () => answer("worker", models[1]!),
    }))
    const result = await router.route(input())
    if (result.kind !== "selected") throw new Error("expected selected route")
    paidAllowed = false
    const refreshed = await router.revalidateSelected(result.decisionId, "parent-1")
    expect(refreshed.kind).toBe("awaiting_selection")
    if (refreshed.kind === "awaiting_selection") expect(refreshed.candidates.some((candidate) => candidate.model.id === "paid")).toBe(false)
  })

  test("uses a stable decision id idempotently and rejects reuse for a different brief", async () => {
    let calls = 0
    const router = createNativeRouter(deps({ choose: async () => { calls += 1; return answer("worker", model("free")) } }))
    const request = input({ decisionId: "stable-task-id" })
    const first = await router.route(request)
    const repeated = await router.route(request)
    expect(repeated).toEqual(first)
    expect(calls).toBe(1)
    await expect(router.route({ ...request, prompt: "different task" })).rejects.toThrow("different task brief or owner")
    expect(calls).toBe(1)
  })

  test("persists the ticket before calling Jev and restart never replays an in-flight paid decision", async () => {
    const rows: NativeLedgerRecord[] = []
    const store: NativeRouterStore = {
      async load() { return [...rows] },
      async append(record) { rows.push(record) },
      async exportLines() { return rows.map((row) => JSON.stringify(row)) },
    }
    let release: ((value: NativeJevAnswer) => void) | undefined
    let jevStarted: (() => void) | undefined
    const started = new Promise<void>((resolvePromise) => { jevStarted = resolvePromise })
    let calls = 0
    const first = createNativeRouter(deps({ store, choose: async () => {
      calls += 1
      expect(rows.some((record) => record.type === "decision" && record.decisionId === "durable-task-id")).toBe(true)
      jevStarted?.()
      return new Promise<NativeJevAnswer>((resolvePromise) => { release = resolvePromise })
    } }))
    const request = input({ decisionId: "durable-task-id" })
    const pendingRoute = first.route(request)
    await started
    expect(rows.some((record) => record.type === "decision" && record.decisionId === "durable-task-id")).toBe(true)
    const recovered = createNativeRouter(deps({ store, choose: async () => { calls += 1; return answer("worker", model("free")) } }))
    const recoveredRoute = await recovered.route(request)
    expect(recoveredRoute.kind).toBe("awaiting_selection")
    expect(calls).toBe(1)
    release?.(answer("worker", model("free")))
    await pendingRoute
  })

  test("returns caller options when Jev confidence or probabilities are malformed", async () => {
    const router = createNativeRouter(deps({ choose: async () => answer("worker", model("free"), Number.NaN, { "worker|connected-provider/free": Number.NaN }) }))

    const result = await router.route(input())

    expect(result.kind).toBe("awaiting_selection")
    if (result.kind === "awaiting_selection") expect(result.reason).toContain("malformed Jev response")
  })

  test("retains the monthly Jev budget cap and exposes options without silently dispatching", async () => {
    let jevCalls = 0
    const base = deps({ choose: async () => { jevCalls += 1; return answer("worker", model("free")) } })
    const router = createNativeRouter({ ...base, config: { monthlyBudgetUsd: 0 } })

    const result = await router.route(input())

    expect(result.kind).toBe("awaiting_selection")
    if (result.kind === "awaiting_selection") expect(result.reason).toBe("jev monthly budget cap reached")
    expect(jevCalls).toBe(0)
  })

  test("billed malformed answers exhaust budgets after restart without replay", async () => {
    const store = memoryStore()
    let calls = 0
    const base = deps({ store, choose: async (_request, audit) => { calls += 1; await audit?.beforeRequest(); await audit?.recordAttempt({ url: "http://fixture", headers: {}, requestBody: {}, status: 200, responseBody: { usage: { input_tokens: 100, output_tokens: 2 } } }); return { ...answer("worker", model("free"), Number.NaN), usage: { costUsd: 999 } } } })
    const first = createNativeRouter({ ...base, config: { monthlyBudgetUsd: 100 * 0.042 / 1_000_000 } })
    expect((await first.route(input({ decisionId: "paid-malformed" }))).kind).toBe("awaiting_selection")
    const saved = (await store.load()).filter((row) => row.type === "decision").at(-1)
    expect(saved?.type === "decision" ? saved.jevUsage?.costUsd : undefined).toBe(100 * 0.042 / 1_000_000)
    const recovered = createNativeRouter({ ...base, config: { monthlyBudgetUsd: 100 * 0.042 / 1_000_000 } })
    const next = await recovered.route(input({ decisionId: "next-paid" }))
    expect(next.kind === "awaiting_selection" ? next.reason : "").toBe("jev monthly budget cap reached")
    expect(calls).toBe(1)
  })

  test("failed durable intent never sends Jev or poisons billing and breaker state", async () => {
    const rows = memoryStore([{ version: 1, type: "breaker", consecutiveFailures: 2, openUntil: 0 }])
    let failed = false
    const store: NativeRouterStore = { ...rows, append: async record => {
      if (!failed && record.type === "jev_call" && record.status === "pending") { failed = true; throw new Error("fixture intent disk failure") }
      await rows.append(record)
    } }
    let calls = 0
    const base = deps({ store, choose: async () => { calls += 1; return { ...answer("worker", model("free")), usage: { costUsd: 0.1 } } } })
    await expect(createNativeRouter({ ...base, config: { monthlyBudgetUsd: 1 } }).route(input({ decisionId: "failed-intent" }))).rejects.toThrow("intent disk failure")
    expect(calls).toBe(0)
    expect((await rows.load()).filter(row => row.type === "breaker")).toEqual([{ version: 1, type: "breaker", consecutiveFailures: 2, openUntil: 0 }])
    const recovered = await createNativeRouter({ ...base, config: { monthlyBudgetUsd: 1 } }).route(input({ decisionId: "after-intent-failure" }))
    expect(recovered.kind).toBe("selected")
    expect(calls).toBe(1)
  })

  test("restart during a pending paid request pauses caps until an actual receipt is saved", async () => {
    const store = memoryStore()
    let calls = 0
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    let release!: (value: NativeJevAnswer) => void
    const reply = new Promise<NativeJevAnswer>(resolve => { release = resolve })
    const base = deps({ store, choose: async (_request, audit) => { calls += 1; await audit?.beforeRequest(); started(); const result = await reply; await audit?.recordAttempt({ url: "http://fixture", headers: {}, requestBody: {}, status: 200, responseBody: { usage: { input_tokens: 100, output_tokens: 2 } } }); return result } })
    const first = createNativeRouter({ ...base, config: { monthlyBudgetUsd: 1 } })
    const running = first.route(input({ decisionId: "paid-inflight" }))
    await entered
    const persisted = (await store.load()).filter((row): row is NativeDecisionRecord => row.type === "decision").at(-1)!
    expect((await store.load()).some(row => row.type === "jev_call" && row.callId === persisted.jevCallId && row.status === "pending")).toBe(true)
    expect(persisted.jevUsage).toBeUndefined()
    const recovered = createNativeRouter({ ...base, config: { monthlyBudgetUsd: 1 } })
    const paused = await recovered.route(input({ decisionId: "after-interruption" }))
    expect(paused.kind === "awaiting_selection" ? paused.reason : "").toContain("monthly spend is unknown")
    expect(calls).toBe(1)
    release({ ...answer("worker", model("free")), usage: { costUsd: 0.5 } })
    await running
    const resolved = await createNativeRouter({ ...base, config: { monthlyBudgetUsd: 1 } }).route(input({ decisionId: "after-receipt" }))
    expect(resolved.kind).toBe("selected")
    expect(calls).toBe(2)
  })

  test("unsent admission denials preserve prior breaker state and allow routing after reenable", async () => {
    const store = memoryStore([{ version: 1, type: "breaker", consecutiveFailures: 2, openUntil: 0 }])
    let denied = true
    let guardCalls = 0
    let httpCalls = 0
    const backend = createNativeJevBackend({ session: "fixture", getApiKey: () => "fixture", maxAttempts: 5, beforeRequest: () => { guardCalls += 1; if (denied) throw new NativeJevAdmissionError("fixture provider is passive") }, postJson: async () => { httpCalls += 1; return { status: 200, body: { answers: { candidate: { type: "choice", choice: "worker|connected-provider/free", confidence: 1, probabilities: { "worker|connected-provider/free": 1 } }, lane: { type: "choice", choice: "direct", confidence: 1, probabilities: { direct: 1 } } }, usage: { input_tokens: 1, output_tokens: 5 } } } } })
    const router = createNativeRouter({ ...deps({ store }), jev: backend, config: { breakerFailures: 3, monthlyBudgetUsd: 1 } })
    for (let index = 0; index < 3; index += 1) {
      const result = await router.route(input({ decisionId: `unsent-${index}` }))
      expect(result.kind === "awaiting_selection" ? result.reason : "").toContain("provider is passive")
    }
    expect(guardCalls).toBe(3)
    expect(httpCalls).toBe(0)
    const rows = await store.load()
    expect(rows.filter(row => row.type === "breaker").at(-1)).toEqual({ version: 1, type: "breaker", consecutiveFailures: 2, openUntil: 0 })
    const latest = new Map(rows.filter((row): row is NativeDecisionRecord => row.type === "decision").map(row => [row.decisionId, row]))
    expect([...latest.values()].every(row => row.jevAttempted === false && row.jevUsage === undefined)).toBe(true)
    denied = false
    const recovered = await createNativeRouter({ ...deps({ store }), jev: backend, config: { breakerFailures: 3, monthlyBudgetUsd: 1 } }).route(input({ decisionId: "after-reenable" }))
    expect(recovered.kind).toBe("selected")
    expect(httpCalls).toBe(1)
  })

  test("later-stage admission rejection preserves both partial input billing and prior breaker state", async () => {
    const store = memoryStore([{ version: 1, type: "breaker", consecutiveFailures: 2, openUntil: 0 }])
    let guards = 0
    let http = 0
    const backend = createNativeJevBackend({ session: "fixture", getApiKey: () => "fixture", maxAttempts: 5, beforeRequest: () => { guards += 1; if (guards > 1) throw new NativeJevAdmissionError("fixture integration became inactive") }, postJson: async () => { http += 1; return { status: 200, body: { answers: { role: { type: "choice", choice: "worker", confidence: 1, probabilities: { worker: 1 } }, lane: { type: "choice", choice: "direct", confidence: 1, probabilities: { direct: 1 } } }, usage: { input_tokens: 13, output_tokens: 5 } } } } })
    const models = Array.from({ length: 53 }, (_, index) => model(`model-${index}`))
    const result = await createNativeRouter({ ...deps({ store, models }), jev: backend, config: { breakerFailures: 3, monthlyBudgetUsd: 1 } }).route(input({ decisionId: "partial-guard" }))
    expect(result.kind === "awaiting_selection" ? result.reason : "").toContain("integration became inactive")
    const rows = await store.load()
    const saved = rows.filter((row): row is NativeDecisionRecord => row.type === "decision").at(-1)!
    expect(saved.jevAttempted).toBe(true)
    expect(saved.jevUsage?.inputTokens).toBe(13)
    expect(saved.jevUsage?.costUsd).toBe(13 * 0.042 / 1_000_000)
    expect(rows.filter(row => row.type === "breaker").at(-1)).toEqual({ version: 1, type: "breaker", consecutiveFailures: 2, openUntil: 0 })
    expect(http).toBe(1)
    expect(guards).toBe(2)
  })

  test("historical malformed answer and HTTP receipts retain monthly spend", async () => {
    const initial = memoryStore()
    await createNativeRouter({ ...deps({ store: initial }), config: { monthlyBudgetUsd: 0 } }).route(input({ decisionId: "historical" }))
    const saved = (await initial.load()).find((row): row is NativeDecisionRecord => row.type === "decision")!
    const httpAttempt = { url: "https://fixture.invalid/systemone", headers: { Authorization: "[redacted]" }, requestBody: { model: "jev", state: "{}", questions: {} }, status: 200, responseBody: { answers: {}, usage: { input_tokens: 123, output_tokens: 4 } } }
    for (const rawResponse of [{ ...answer("worker", model("free"), 2), usage: { costUsd: 0.5 } }, { httpAttempts: [httpAttempt] }]) {
      let calls = 0
      const old = { ...saved, jevCallId: undefined, jevAttempted: undefined, jevUsage: undefined, jevAnswer: undefined, jevFailure: { message: "malformed Jev response", rawResponse } }
      const store = memoryStore([old])
      const result = await createNativeRouter({ ...deps({ store, choose: async () => { calls += 1; return answer("worker", model("free")) } }), config: { monthlyBudgetUsd: 0.000001 } }).route(input({ decisionId: "after-historical" }))
      expect(result.kind === "awaiting_selection" ? result.reason : "").toBe("jev monthly budget cap reached")
      expect(calls).toBe(0)
      expect((await store.load())[0]).toEqual(old)
    }
  })

  test("historical audited unknown billing pauses caps while skipped calls remain unbilled", async () => {
    const initial = memoryStore()
    await createNativeRouter({ ...deps({ store: initial }), config: { monthlyBudgetUsd: 0 } }).route(input({ decisionId: "historical" }))
    const saved = (await initial.load()).find((row): row is NativeDecisionRecord => row.type === "decision")!
    const old = { ...saved, jevCallId: undefined, jevAttempted: undefined, jevUsage: undefined, jevAnswer: undefined, jevFailure: { message: "network failure", rawResponse: { httpAttempts: [{ url: "https://fixture.invalid/systemone", headers: {}, requestBody: { model: "jev", state: "{}", questions: {} }, error: "network failure" }] } } }
    let calls = 0
    const choose = async () => { calls += 1; return { ...answer("worker", model("free")), usage: { costUsd: 0 } } }
    const paused = await createNativeRouter({ ...deps({ store: memoryStore([old]), choose }), config: { monthlyBudgetUsd: 1 } }).route(input({ decisionId: "unknown-old" }))
    expect(paused.kind === "awaiting_selection" ? paused.reason : "").toContain("monthly spend is unknown")
    expect(calls).toBe(0)
    const allowed = await createNativeRouter({ ...deps({ store: memoryStore([saved]), choose }), config: { monthlyBudgetUsd: 1 } }).route(input({ decisionId: "skipped-old" }))
    expect(allowed.kind).toBe("selected")
    expect(calls).toBe(1)
  })

  test("malformed unknown billing pauses capped routing after restart", async () => {
    const store = memoryStore()
    let calls = 0
    const base = deps({ store, choose: async () => { calls += 1; return answer("worker", model("free"), Number.NaN) } })
    await createNativeRouter({ ...base, config: { monthlyBudgetUsd: 1 } }).route(input({ decisionId: "unknown-billing" }))
    const next = await createNativeRouter({ ...base, config: { monthlyBudgetUsd: 1 } }).route(input({ decisionId: "next-unknown" }))
    expect(next.kind === "awaiting_selection" ? next.reason : "").toBe("jev monthly spend is unknown; Jev paused for budget safety")
    expect(calls).toBe(1)
  })

  test("keeps concurrent catalog snapshots independent", async () => {
    let call = 0
    const capturedSnapshots: string[][] = []
    const router = createNativeRouter({
      ...deps({ choose: async (request) => {
        capturedSnapshots.push([...new Set(request.candidates.map((candidate) => candidate.model.id))])
        return answer("worker", request.candidates[0]!.model)
      } }),
      catalog: { listAvailable: () => {
        call += 1
        return [model(`snapshot-${call}`)]
      } },
    })

    await Promise.all([router.route(input()), router.route(input({ prompt: "independent concurrent task" }))])

    expect(capturedSnapshots).toEqual([["snapshot-1"], ["snapshot-2"]])
  })

  test("adapts full candidate facts into Jev criteria dictionaries and respects its lane answer", async () => {
    const models = [model("worker-model", { inputPricePerMillion: 0.15, outputPricePerMillion: 0.6, contextLength: 64_000, toolCall: true })]
    let capturedState = ""
    let capturedQuestions: JevQuestionSet = {}
    const client: JevClient = {
      async ask(state: string, questions: JevQuestionSet): Promise<JevCallResult> {
        capturedState = state
        capturedQuestions = questions
        const candidates = questions.candidate?.type === "choice" ? questions.candidate.criteria : {}
        const choice = Object.keys(candidates).find((key) => key.startsWith("worker|"))!
        return {
          model: "jev-test",
          answers: {
            candidate: { type: "choice", choice, confidence: 0.96, probabilities: { [choice]: 1 } },
            lane: { type: "choice", choice: "direct", confidence: 0.99, probabilities: { direct: 1 } },
          },
          usage: { inputTokens: 100, outputTokens: 20 },
          latencyMs: 4,
          costUsd: 0.0000042,
        }
      },
    }
    const router = createNativeRouter({ ...deps({ models }), jev: createNativeJevAdapter(client) })

    const result = await router.route(input())

    expect(result.kind).toBe("selected")
    expect(JSON.parse(capturedState).input).toEqual({ ...input(), decisionId: "decision-1" })
    expect(capturedQuestions.candidate?.type).toBe("choice")
    expect(capturedQuestions.candidate?.type === "choice" ? Object.keys(capturedQuestions.candidate.criteria) : []).toHaveLength(8)
    expect(capturedQuestions.lane?.type).toBe("choice")
  })

  test("binds Jev HTTP to each request root session and records sanitized exact transport evidence", async () => {
    const modelRef = model("worker-model")
    let requestHeaders: Record<string, string> = {}
    let requestBody: unknown
    const backend = createNativeJevBackend({
      session: "fixed-plugin-session",
      getApiKey: () => "secret-api-key",
      postJson: async (_url, headers, body) => {
        requestHeaders = headers
        requestBody = body
        const key = "worker|connected-provider/worker-model"
        return {
          status: 200,
          body: {
            model: "jev-test",
            answers: {
              candidate: { type: "choice", choice: key, confidence: 0.96, probabilities: { [key]: 1 } },
              lane: { type: "choice", choice: "direct", confidence: 0.99, probabilities: { direct: 1 } },
            },
            usage: { input_tokens: 100, output_tokens: 20 },
          },
        }
      },
    })
    const request: Parameters<NativeRouterDeps["jev"]["choose"]>[0] = {
      decisionId: "ticket-1",
      input: input({ rootSessionID: "root-session-42" }),
      allowedRoles: ["worker"],
      candidates: [{
        role: "worker", model: modelRef, facts: { ...modelRef, available: true, inputPricePerMillion: 0, outputPricePerMillion: 0, priceCurrency: "USD", priceSource: "provider", priceOrigin: "https://provider.example/free-pricing" },
        knowledge: { model: modelRef, known: false },
      }],
      knowledge: [], outcomes: [], instructions: "full decision brief",
    }
    const result = await backend.choose(request)
    expect(requestHeaders["x-opencode-session"]).toBe("root-session-42")
    expect(requestHeaders.Authorization).toBe("Bearer secret-api-key")
    expect(JSON.stringify(requestBody)).toContain("full decision brief")
    const sent = requestBody as { questions: { candidate: { criteria: Record<string, string> } } }
    const candidateCriteria = JSON.parse(sent.questions.candidate.criteria["worker|connected-provider/worker-model"]!) as Record<string, unknown>
    expect(candidateCriteria.pricesPerMillion).toEqual({ input: 0, output: 0 })
    expect(candidateCriteria.priceCurrency).toBe("USD")
    expect(candidateCriteria.priceOrigin).toBe("https://provider.example/free-pricing")
    expect(JSON.stringify(result.source)).toContain("root-session-42")
    expect(JSON.stringify(result.source)).toContain("[redacted]")
    expect(JSON.stringify(result.source)).not.toContain("secret-api-key")
    expect(JSON.stringify(result.source)).toContain('"status":200')
  })

  test("sends sourced free, priced, and unknown candidates to real Jev transport so an adequate free candidate can win", async () => {
    let criteria: Record<string, string> = {}
    const backend = createNativeJevBackend({
      getApiKey: () => "fixture-key",
      postJson: async (_url, _headers, body) => {
        const payload = body as { questions: { candidate: { criteria: Record<string, string> } } }
        criteria = payload.questions.candidate.criteria
        const adequate = Object.entries(criteria).filter(([, serialized]) => {
          const item = JSON.parse(serialized) as { pricesPerMillion: { input: number | string; output: number | string }; contextLength: number; toolCall: boolean }
          return item.toolCall && item.contextLength >= 32_000 && item.pricesPerMillion.input !== "unknown" && item.pricesPerMillion.output !== "unknown"
        })
        const selected = adequate.find(([key, serialized]) => {
          const item = JSON.parse(serialized) as { pricesPerMillion: { input: number | string; output: number | string } }
          return key.includes("free/") && item.pricesPerMillion.input === 0 && item.pricesPerMillion.output === 0
        }) ?? adequate.sort((left, right) => {
          const getCost = (value: string) => {
            const item = JSON.parse(value) as { pricesPerMillion: { input: number | string; output: number | string } }
            return Number(item.pricesPerMillion.input) + Number(item.pricesPerMillion.output)
          }
          return getCost(left[1]) - getCost(right[1])
        })[0]
        if (!selected) throw new Error("no adequate candidate was delivered to Jev")
        return { status: 200, body: { model: "local-jev", answers: {
          candidate: { type: "choice", choice: selected[0], confidence: 0.98, probabilities: { [selected[0]]: 1 } },
          lane: { type: "choice", choice: "direct", confidence: 0.99, probabilities: { direct: 1 } },
        }, usage: { input_tokens: 25, output_tokens: 5 } } }
      },
    })
    const candidates: NativeJevRequest["candidates"] = [
      { role: "worker", model: model("free-model", { providerID: "free" }), facts: { ...model("free-model", { providerID: "free", inputPricePerMillion: 0, outputPricePerMillion: 0, priceCurrency: "USD", priceSource: "provider", priceOrigin: "https://provider.example/free", contextLength: 64_000, toolCall: true }), available: true }, knowledge: { model: model("free-model", { providerID: "free" }), known: false } },
      { role: "worker", model: model("paid-model", { providerID: "paid" }), facts: { ...model("paid-model", { providerID: "paid", inputPricePerMillion: 0.2, outputPricePerMillion: 0.4, priceCurrency: "USD", priceSource: "opencode.model.list", priceOrigin: "opencode.model.list", contextLength: 64_000, toolCall: true }), available: true }, knowledge: { model: model("paid-model", { providerID: "paid" }), known: false } },
      { role: "worker", model: model("unknown-zero", { providerID: "unknown" }), facts: { ...model("unknown-zero", { providerID: "unknown", priceCurrency: "unknown", priceSource: "unknown", contextLength: 64_000, toolCall: true }), available: true }, knowledge: { model: model("unknown-zero", { providerID: "unknown" }), known: false } },
    ]
    const result = await backend.choose({
      decisionId: "free-price-proof", input: input({ requiredContextLength: 32_000 }), allowedRoles: ["worker"], candidates,
      knowledge: [], outcomes: [], instructions: "choose least cost adequate",
    })

    expect(result.model).toMatchObject({ providerID: "free", id: "free-model" })
    expect(JSON.parse(criteria["worker|free/free-model"]!).priceCurrency).toBe("USD")
    expect(JSON.parse(criteria["worker|free/free-model"]!).priceOrigin).toBe("https://provider.example/free")
    expect(JSON.parse(criteria["worker|unknown/unknown-zero"]!).pricesPerMillion).toEqual({ input: "unknown", output: "unknown" })
    expect(JSON.parse(criteria["worker|paid/paid-model"]!).pricesPerMillion).toEqual({ input: 0.2, output: 0.4 })
  })

  test("retains sanitized Jev HTTP status and error evidence on failures", async () => {
    const backend = createNativeJevBackend({
      session: "ignored",
      getApiKey: () => "secret-api-key",
      postJson: async () => ({ status: 403, body: { error: "forbidden" } }),
      maxAttempts: 1,
    })
    const modelRef = model("worker-model")
    const request: Parameters<NativeRouterDeps["jev"]["choose"]>[0] = {
      decisionId: "ticket-2", input: input({ rootSessionID: "root-session-84" }),
      allowedRoles: ["worker"], candidates: [{ role: "worker", model: modelRef, facts: modelRef, knowledge: { model: modelRef, known: false } }],
      knowledge: [], outcomes: [], instructions: "full decision brief",
    }
    let captured: unknown
    try { await backend.choose(request) } catch (error) { captured = error }
    expect(JSON.stringify(nativeJevFailureEvidence(captured))).toContain('"status":403')
    expect(JSON.stringify(nativeJevFailureEvidence(captured))).not.toContain("secret-api-key")
  })

  test("persists breaker failures and stops Jev calls while the breaker is open", async () => {
    const store = memoryStore()
    let calls = 0
    let id = 0
    const configuration = { breakerFailures: 2, breakerCooldownMs: 60_000, now: () => 100, createId: () => `breaker-${++id}` }
    const first = createNativeRouter({
      ...deps({ store, choose: async () => { calls += 1; throw new Error("offline") } }),
      config: configuration,
    })
    await first.route(input())
    const second = createNativeRouter({
      ...deps({ store, choose: async () => { calls += 1; throw new Error("offline") } }),
      config: configuration,
    })
    await second.route(input())
    const afterOpen = await second.route(input())

    expect(afterOpen).toMatchObject({ kind: "awaiting_selection", reason: "jev circuit breaker is open" })
    expect(calls).toBe(2)
  })

  test("records actual dispatch identity and accepts only runtime outcomes with unknown verification by default", async () => {
    const store = memoryStore()
    const selectedModel = model("free")
    const router = createNativeRouter(deps({ store, choose: async () => answer("worker", selectedModel) }))
    const result = await router.route(input())
    if (result.kind !== "selected") throw new Error("expected Jev selection")
    const dispatch = { taskId: "task-1", sessionId: "child-session-1", role: "worker" as const, model: selectedModel }
    await router.recordDispatch(result.decisionId, dispatch, "parent-1")
    const outcome = {
      model: selectedModel,
      role: "worker" as const,
      taskKind: "task" as const,
      result: "success" as const,
      provenance: "runtime" as const,
      taskId: dispatch.taskId,
      sessionId: dispatch.sessionId,
    }
    await router.recordOutcome(result.decisionId, outcome, "parent-1")
    const exported = await router.exportLedger()
    const last = JSON.parse(exported.at(-1)!) as NativeDecisionRecord

    expect(last.selected).toMatchObject({ taskId: "task-1", sessionId: "child-session-1", by: "jev" })
    expect(last.outcome).toMatchObject({ result: "success", verification: "unknown", provenance: "runtime" })
    await expect(router.recordOutcome(result.decisionId, { ...outcome, provenance: "operator" }, "parent-1")).rejects.toThrow("runtime task state")
  })

  test("rejects a dispatch that differs from Jev's exact selected role and model", async () => {
    const router = createNativeRouter(deps())
    const routed = await router.route(input())
    if (routed.kind !== "selected") throw new Error("expected selected model")
    await expect(router.recordDispatch(routed.decisionId, {
      taskId: "task-1", sessionId: "child-1", role: "explore", model: routed.model,
    }, "parent-1")).rejects.toThrow("does not match the selected")
  })

  test("keeps an identical recorded dispatch idempotent after catalog availability changes", async () => {
    let available = true
    const selectedModel = model("free")
    const baseDeps = deps({ models: [selectedModel], choose: async () => answer("worker", selectedModel) })
    const router = createNativeRouter(deps({
      ...baseDeps,
      catalog: { listAvailable: () => available ? [selectedModel] : [] },
    }))
    const routed = await router.route(input())
    if (routed.kind !== "selected") throw new Error("expected selected model")
    const dispatch = { taskId: "task-1", sessionId: "child-1", role: "worker" as const, model: selectedModel }
    await router.recordDispatch(routed.decisionId, dispatch, "parent-1")
    available = false

    await expect(router.recordDispatch(routed.decisionId, dispatch, "parent-1")).resolves.toBeUndefined()
    await expect(router.recordDispatch(routed.decisionId, { ...dispatch, taskId: "other" }, "parent-1")).rejects.toThrow("already assigned")
  })

  test("preserves legacy JSONL rows while exporting versioned routing decisions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "momo-native-ledger-"))
    tempDirs.push(directory)
    const path = join(directory, "routing.jsonl")
    const legacyPath = join(directory, "legacy.jsonl")
    const legacy = '{"schemaVersion":2,"id":"legacy-export","training":{"answer":"kept"}}\n'
    const malformed = '{"version":1,"type":"decision","decisionId":"broken"}\n'
    await (await import("node:fs/promises")).writeFile(legacyPath, legacy + malformed, "utf8")
    const reported: Array<[number, string]> = []
    const store = createJsonlNativeRouterStore(path, { legacyPaths: [legacyPath], onMalformedRecord: (line, reason) => reported.push([line, reason]) })
    const candidate = model("free")
    const router = createNativeRouter(deps({ store, choose: async () => answer("worker", candidate) }))
    const result = await router.route(input())
    const exported = await router.exportLedger()
    const contents = await readFile(path, "utf8")

    expect(result.kind).toBe("selected")
    expect(exported[0]).toBe(legacy.trim())
    expect(exported[1]).toBe(malformed.trim())
    expect(reported).toEqual([])
    expect(contents.startsWith("{\"version\":2,")).toBe(true)
    const parsed = JSON.parse(exported.at(-1)!) as NativeDecisionRecord
    expect(parsed.version).toBe(1)
    expect(parsed.request.input.prompt).toBe(input().prompt)
  })

  test("exports a real legacy ledger path without loading its rows as native state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "momo-native-legacy-export-"))
    tempDirs.push(directory)
    const legacyPath = join(directory, ".omo", "decision-ledger.jsonl")
    const nativePath = join(directory, "projects", "root", "routing-ledger.jsonl")
    const legacy = '{"schemaVersion":2,"id":"legacy-live","training":{"answer":"unchanged"}}\n{malformed legacy row}\n'
    await (await import("node:fs/promises")).mkdir(join(directory, ".omo"), { recursive: true })
    await (await import("node:fs/promises")).writeFile(legacyPath, legacy, "utf8")
    const store = createJsonlNativeRouterStore(nativePath, { legacyPaths: [legacyPath, nativePath] })
    const loadedBeforeRoute = await store.load()
    const candidate = model("free")
    const router = createNativeRouter(deps({ store, choose: async () => answer("worker", candidate) }))
    const result = await router.route(input())
    const exported = await router.exportLedger()

    expect(loadedBeforeRoute).toEqual([])
    expect(result.kind).toBe("selected")
    expect(exported.slice(0, 2)).toEqual(legacy.trimEnd().split("\n"))
    expect(exported.filter((line) => line.includes('"legacy-live"'))).toHaveLength(1)
    expect(await readFile(legacyPath, "utf8")).toBe(legacy)
    expect((await store.load()).some((record) => record.type === "decision")).toBe(true)
  })

  test("stores the JSONL ledger with private permissions and reports non-serializable records", async () => {
    const directory = await mkdtemp(join(tmpdir(), "native-router-private-store-"))
    tempDirs.push(directory)
    const path = join(directory, "nested", "ledger.jsonl")
    const store = createJsonlNativeRouterStore(path)
    const valid = await createNativeRouter(deps({ store })).route(input())
    expect(valid.kind).toBe("selected")
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    const circular: { version: 1; type: "breaker"; consecutiveFailures: number; openUntil: number; loop?: unknown } = {
      version: 1, type: "breaker", consecutiveFailures: 0, openUntil: 0,
    }
    circular.loop = circular
    await expect(store.append(circular)).rejects.toThrow("not JSON serializable")
  })
})

test("given catalog preparation shares the last budget unit, it completes before routing acquires the accountant queue", async () => {
  const store = memoryStore(), accountant = createNativeJevAccountant({ store, monthlyBudgetUsd: 100 * 0.042 / 1_000_000 })
  let prepared = 0, routes = 0
  const base = deps({ store }), router = createNativeRouter({ ...base, accountant, jev: {
    async prepare() {
      await accountant.run({ callId: "classification-warmup", purpose: "classification", inputDigest: "a".repeat(64) }, async audit => {
        await audit.beforeRequest(); prepared++
        await audit.recordAttempt({ url: "http://fixture", headers: {}, requestBody: {}, status: 200, responseBody: { usage: { input_tokens: 100 } } })
      })
    },
    async choose() { routes++; return answer("worker", model("free")) },
  } })
  const result = await router.route(input())
  expect(result.kind === "awaiting_selection" ? result.reason : "").toBe("jev monthly budget cap reached")
  expect(prepared).toBe(1); expect(routes).toBe(0); expect((await store.load()).filter(row => row.type === "breaker")).toEqual([])
})
test("given preparation reports semantic pending work, caller selection remains available without opening the provider breaker", async () => {
  const store = memoryStore(), base = deps({ store }); let routes = 0
  const router = createNativeRouter({ ...base, jev: { prepare: () => { throw new Error("class profiles pending") }, choose: async () => { routes++; return answer("worker", model("free")) } } })
  const result = await router.route(input()); expect(result.kind).toBe("awaiting_selection"); expect(routes).toBe(0)
  expect((await store.load()).filter(row => row.type === "breaker" || row.type === "jev_call")).toEqual([])
})
