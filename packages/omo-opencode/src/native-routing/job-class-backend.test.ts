import { expect, test } from "bun:test"
import { NativeJevAdmissionError, type JevQuestionSet } from "@oh-my-opencode/decision-core"
import { createJobClassJevBackend } from "./job-class-backend"
import { createNativeJevAccountant } from "./jev-accountant"
import { createNativeRouter } from "./router"
import type { NativeJevCallRecord, NativeLedgerRecord, NativeRouteInput, NativeRouterStore } from "./types"

const input: NativeRouteInput = { prompt: "Investigate a bug", parentRole: "orchestrator", rootSessionID: "SECRET_ROOT", parentSessionID: "SECRET_ROOT", kind: "task" }
const definitions = { version: "v1", classifierVersion: "v1", classes: [
  { id: "coding", description: "Implementation" }, { id: "research", description: "Investigation" }, { id: "planning", description: "Planning" },
] }
function fixture(options: { low?: string; jobClass?: string; denyStage2?: boolean; preparePaid?: boolean; changedProfile?: boolean } = {}) {
  const rows: NativeLedgerRecord[] = [], requests: { state: string; questions: JevQuestionSet }[] = []
  const store: NativeRouterStore = { load: async () => rows, append: async row => { rows.push(structuredClone(row)) }, exportLines: async () => rows.map(row => JSON.stringify(row)) }
  const accountant = createNativeJevAccountant({ store, monthlyBudgetUsd: 1 })
  let guards = 0, prepared = false, stale = false
  const backend = createJobClassJevBackend({ session: "fixture", getApiKey: () => "fixture", maxAttempts: 1,
    beforeRequest: () => { guards++; if (options.changedProfile && guards > 1) stale = true; if (options.denyStage2 && guards > 1) throw new NativeJevAdmissionError("provider was disabled") },
    postJson: async (_url, _headers, body) => {
      requests.push({ state: body.state, questions: body.questions })
      return { status: 200, body: { usage: { input_tokens: 100, output_tokens: 9999 }, answers: Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
        if (question.type !== "choice") throw new Error("expected choice question")
        const choice = key === "jobClass" ? options.jobClass ?? "research" : key === "role" ? "research" : key === "lane" ? "direct" : Object.keys(question.criteria)[0]!
        return [key, { type: "choice", choice, confidence: options.low === key ? 0.1 : 1, probabilities: { [choice]: 1 } }]
      })) } }
    },
  }, { definitions,
    readClassMembership: model => stale ? undefined : [{ classId: model.id === "SECRET_CODE" ? "coding" : "research", suitability: "suitable", confidence: 1 }],
    prepare: async () => {
      if (prepared || !options.preparePaid) return
      await accountant.run({ callId: "classify-first", purpose: "classification", inputDigest: "a".repeat(64) }, async audit => {
        await audit.beforeRequest(); await audit.recordAttempt({ url: "http://fixture", headers: {}, requestBody: {}, status: 200, responseBody: { usage: { input_tokens: 50 } } })
      }); prepared = true
    },
  })
  const router = createNativeRouter({ jev: backend, accountant, store,
    catalog: { listAvailable: () => ["SECRET_CODE", "SECRET_RESEARCH"].map(id => ({ providerID: "SECRET_PROVIDER", id, available: true, toolCall: true })) },
    pool: { isAllowed: () => true }, knowledge: { get: model => ({ model, known: true, summary: "SECRET_FACTS" }) }, outcomes: { list: () => [] },
    config: { breakerFailures: 1 },
  })
  const receipt = () => rows.filter((row): row is NativeJevCallRecord => row.type === "jev_call" && row.purpose === "routing").at(-1)
  return { router, rows, requests, receipt }
}

test("given cached classes, raw class and role requests omit models and final criteria intersect selected class and role", async () => {
  const f = fixture(), result = await f.router.route({ ...input, decisionId: "success" })
  expect(result).toMatchObject({ kind: "selected", role: "research", model: { id: "SECRET_RESEARCH" } }); expect(f.requests).toHaveLength(3)
  for (const request of f.requests.slice(0, 2)) for (const secret of ["SECRET_PROVIDER", "SECRET_CODE", "SECRET_RESEARCH", "SECRET_FACTS", "SECRET_ROOT"]) expect(JSON.stringify(request)).not.toContain(secret)
  const final = f.requests[2]!.questions.candidate!
  expect(final.type).toBe("choice"); if (final.type !== "choice") throw new Error("expected choice")
  expect(Object.keys(final.criteria)).toEqual(["research|SECRET_PROVIDER/SECRET_RESEARCH"])
  expect(f.receipt()?.usage?.inputTokens).toBe(300); expect(f.receipt()?.usage?.costUsd).toBe(300 * 0.042 / 1_000_000)
})
test("given paid low-confidence class selection, prior usage remains charged without opening the provider breaker", async () => {
  const f = fixture({ low: "jobClass" }), result = await f.router.route({ ...input, decisionId: "low" })
  expect(result.kind).toBe("awaiting_selection"); expect(f.requests).toHaveLength(1); expect(f.receipt()?.usage?.inputTokens).toBe(100)
  expect(f.rows.filter(row => row.type === "breaker")).toEqual([])
})
test("given a valid class without suitable models, one paid class request yields caller choice without a breaker failure", async () => {
  const f = fixture({ jobClass: "planning" }), result = await f.router.route({ ...input, decisionId: "empty" })
  expect(result.kind).toBe("awaiting_selection"); expect(f.requests).toHaveLength(1); expect(f.receipt()?.usage?.inputTokens).toBe(100)
  expect(f.rows.filter(row => row.type === "breaker")).toEqual([])
  const first = f.requests[0]!.questions.jobClass!; if (first.type !== "choice") throw new Error("expected choice")
  expect(Object.keys(first.criteria)).toEqual(["coding", "research", "planning"])
})
test("given the provider becomes passive before stage two, its refusal preserves first-stage billing without poisoning the circuit", async () => {
  const f = fixture({ denyStage2: true }), result = await f.router.route({ ...input, decisionId: "disabled-stage2" })
  expect(result.kind).toBe("awaiting_selection"); expect(f.requests).toHaveLength(1)
  expect(f.receipt()).toMatchObject({ status: "complete", usage: { inputTokens: 100, costUsd: 100 * 0.042 / 1_000_000 } })
  expect(f.rows.filter(row => row.type === "breaker")).toEqual([])
})
test("given classification preparation uses the shared accountant, it completes outside the routing paid queue", async () => {
  const f = fixture({ preparePaid: true }); expect((await f.router.route({ ...input, decisionId: "prepared" })).kind).toBe("selected")
  const completed = f.rows.filter((row): row is NativeJevCallRecord => row.type === "jev_call" && row.status === "complete")
  expect(completed.map(row => row.purpose)).toEqual(["classification", "routing"])
})

test("given paid low-confidence role selection, both class and role receipts remain charged without opening the breaker", async () => {
  const f = fixture({ low: "role" }), result = await f.router.route({ ...input, decisionId: "low-role" })
  expect(result.kind).toBe("awaiting_selection"); expect(f.requests).toHaveLength(2); expect(f.receipt()?.usage?.inputTokens).toBe(200)
  expect(f.rows.filter(row => row.type === "breaker")).toEqual([])
})

test("given source facts invalidate a cached profile between stages, no stale role or model request is sent", async () => {
  const f = fixture({ changedProfile: true })
  const result = await f.router.route({ ...input, decisionId: "changed-profile" })
  expect(result.kind).toBe("awaiting_selection")
  expect(f.requests).toHaveLength(1)
  expect(f.receipt()?.usage?.inputTokens).toBe(100)
  expect(f.rows.filter(row => row.type === "breaker")).toEqual([])
})
