import { describe, expect, test } from "bun:test"
import { createNativeLedgerOutcomeReader } from "./outcome-reader"
import { createNativeRouter } from "./router"
import type { NativeRouterStore } from "./types"

function ledgerStore(): NativeRouterStore {
  const rows: Awaited<ReturnType<NativeRouterStore["load"]>>[number][] = []
  return {
    load: async () => [...rows],
    append: async (row) => { rows.push(row) },
    exportLines: async () => rows.map((row) => JSON.stringify(row)),
  }
}

describe("native runtime outcome reader", () => {
  test("reads only actual runtime outcomes back from decision ledger records", async () => {
    const store = ledgerStore()
    const model = { providerID: "provider", id: "model", available: true }
    const router = createNativeRouter({
      jev: { choose: async () => ({ role: "worker", model, confidence: 0.99, probabilities: { "worker|provider/model": 1 }, lane: "direct" }) },
      catalog: { listAvailable: () => [model] },
      pool: { isAllowed: () => true },
      knowledge: { get: () => ({ model, known: false }) },
      outcomes: { list: () => [] },
      store,
    })
    const routed = await router.route({
      decisionId: "task-1", prompt: "do work", parentRole: "orchestrator", parentSessionID: "root-session",
      rootSessionID: "root-session", kind: "task",
    })
    expect(routed.kind).toBe("selected")
    if (routed.kind !== "selected") throw new Error("expected selected model")
    await router.recordDispatch(routed.decisionId, { taskId: "task-1", sessionId: "child-session", role: routed.role, model: routed.model }, "root-session")
    await router.recordOutcome(routed.decisionId, {
      model: routed.model, role: routed.role, taskKind: "task", result: "success", provenance: "runtime",
      taskId: "task-1", sessionId: "child-session", verification: "unknown",
    }, "root-session")

    expect(await createNativeLedgerOutcomeReader(store).list()).toEqual([{
      model: routed.model, role: routed.role, taskKind: "task", result: "success", provenance: "runtime",
      taskId: "task-1", sessionId: "child-session", verification: "unknown",
    }])
  })
})
