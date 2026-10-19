import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NativeJevAdmissionError, type JevQuestionSet } from "@oh-my-opencode/decision-core"
import { ManagerConfigSchema } from "../config/schema/decision-engine"
import type { NativeCatalogModelFacts, NativeCatalogSnapshot } from "../native-catalog/types"
import type { NativeLedgerRecord, NativeRouterStore } from "../native-routing/types"
import { createNativeRouter } from "../native-routing/router"
import { createCatalogJobRouting } from "./catalog-job-routing"
const cleanups: (() => void)[] = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })
function fixture(cap = 1) {
  const directory = mkdtempSync(join(tmpdir(), "momo-job-assembly-")); cleanups.push(() => rmSync(directory, { recursive: true, force: true }))
  const requests: { state: string; questions: JevQuestionSet }[] = [], rows: NativeLedgerRecord[] = []
  let models: NativeCatalogModelFacts[] = [{ providerID: "fixture", id: "one", available: true, toolCall: true, contextLength: 32000 }]
  let researchedSummary: string | undefined
  let revision = "1", active = true, classifierGuards = 0, routingGuards = 0, advisorChecks = 0
  let classificationAdmission: (() => void) | undefined
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    const body = await request.json() as { state: string; questions: JevQuestionSet }; requests.push(body)
    const answers = Object.fromEntries(Object.entries(body.questions).map(([key, question]) => {
      if (question.type !== "choice") throw new Error("expected choice")
      const choice = key.startsWith("m") ? "suitable" : key === "jobClass" ? "coding" : key === "role" ? "worker" : key === "lane" ? "direct" : Object.keys(question.criteria)[0]!
      return [key, { type: "choice", choice, confidence: 1, probabilities: { [choice]: 1 } }]
    }))
    return Response.json({ answers, usage: { input_tokens: 100, output_tokens: 1 } })
  } }); cleanups.push(() => { server.stop(true) })
  const store: NativeRouterStore = { load: async () => rows, append: async row => { rows.push(structuredClone(row)) }, exportLines: async () => rows.map(row => JSON.stringify(row)) }
  const catalog = {
    catalog: { listAvailable: async () => models },
    pool: { isAllowed: (model: { id: string }) => model.id !== "excluded", isConsultationAllowed: () => { advisorChecks++; return false } },
    knowledge: { get: (model: { providerID: string; id: string }) => ({ model, known: researchedSummary !== undefined, ...(researchedSummary ? { summary: researchedSummary, source: "https://example.test/model" } : {}) }) },
    snapshot: (): NativeCatalogSnapshot => ({ fetchedAt: "", connectedProviders: ["fixture"], models, sources: {}, transportModelIDs: {}, unregisteredLiveModels: {}, unavailableProviders: {} }),
  }
  const make = (waitForKnowledge = false) => createCatalogJobRouting({ waitForKnowledge, directory, dataRoot: directory, profileCacheDirectory: join(directory, "shared"), catalog, routerStore: store,
    managerConfig: ManagerConfigSchema.parse({ jev: { base_url: server.url.href, max_attempts: 1, budget: { monthly_cap_usd: cap } } }),
    getApiKey: () => "fixture", revision: () => revision,
    beforeClassificationRequest: () => { classifierGuards++; const callback = classificationAdmission; classificationAdmission = undefined; callback?.(); if (!active) throw new NativeJevAdmissionError("fixture provider disabled") },
    beforeRoutingRequest: () => { routingGuards++; if (!active) throw new NativeJevAdmissionError("fixture provider disabled") },
  })
  return { make, research: (summary: string) => { researchedSummary = summary }, duringClassificationAdmission: (callback: () => void) => { classificationAdmission = callback }, models: (next: NativeCatalogModelFacts[]) => { models = next; revision += "x" }, active: (value: boolean) => { active = value; revision += "x" }, requests, rows,
    counts: () => ({ classifierGuards, routingGuards, advisorChecks }), catalog, store }
}

test("given assembled catalog routing, unchanged source profiles survive prepare/restart and ignore price-only changes", async () => {
  const f = fixture(), routing = f.make(); await routing.classifier.prepare(); await routing.classifier.prepare(); await f.make().classifier.prepare()
  expect(f.requests).toHaveLength(1); expect(Object.keys(f.requests[0]!.questions)).toHaveLength(6)
  f.models([{ providerID: "fixture", id: "one", available: true, toolCall: true, contextLength: 32000, inputPricePerMillion: 99 }]); await routing.classifier.prepare()
  expect(f.requests).toHaveLength(1); expect(routing.classifier.memberships({ providerID: "fixture", id: "one" })).toHaveLength(6)
  expect(f.counts().advisorChecks).toBe(0)
})
test("given global hard-pool exclusions and changed capabilities, only eligible changed source rows are classified", async () => {
  const f = fixture(), routing = f.make(); await routing.classifier.prepare()
  f.models([{ providerID: "fixture", id: "one", available: true, toolCall: true, contextLength: 64000 }, { providerID: "fixture", id: "excluded", available: true, toolCall: true }]); await routing.classifier.prepare()
  expect(f.requests).toHaveLength(2)
  const state = JSON.parse(f.requests[1]!.state) as { models: { model: { id: string } }[] }
  expect(state.models.map(row => row.model.id)).toEqual(["one"]); expect(f.counts().classifierGuards).toBe(2)
})
test("given provider controls change, a durable no-send pause resumes using the mandatory revision callback", async () => {
  const f = fixture(), routing = f.make(); f.active(false); await routing.classifier.prepare()
  expect(f.requests).toHaveLength(0); expect(routing.classifier.status().paused).toBe(1)
  f.active(true); await routing.classifier.prepare(); expect(f.requests).toHaveLength(1); expect(routing.classifier.status().completedProfiles).toBe(1)
})
test("given assembled routing preparation consumes the shared cap, no task-routing HTTP request starts", async () => {
  const f = fixture(100 * 0.042 / 1_000_000), routing = f.make()
  const router = createNativeRouter({ jev: routing.jev, accountant: routing.accountant, ...f.catalog, store: f.store, outcomes: { list: () => [] } })
  const result = await router.route({ decisionId: "shared-cap", prompt: "Implement a fix", parentRole: "orchestrator", rootSessionID: "root", parentSessionID: "root", kind: "task" })
  expect(result.kind === "awaiting_selection" ? result.reason : "").toBe("jev monthly budget cap reached")
  expect(f.requests).toHaveLength(1); expect(f.counts().routingGuards).toBe(0)
})

test("given assembled runtime routing, one catalog classification feeds later class-role-model selection", async () => {
  const f = fixture(), routing = f.make()
  const router = createNativeRouter({ jev: routing.jev, accountant: routing.accountant, ...f.catalog, store: f.store, outcomes: { list: () => [] } })
  const result = await router.route({ decisionId: "success", prompt: "Implement a fix", parentRole: "orchestrator", rootSessionID: "root", parentSessionID: "root", kind: "task" })
  expect(result).toMatchObject({ kind: "selected", role: "worker", model: { providerID: "fixture", id: "one" } })
  expect(f.requests).toHaveLength(4); expect(f.counts()).toMatchObject({ classifierGuards: 1, routingGuards: 3, advisorChecks: 0 })
  expect(f.rows.filter(row => row.type === "jev_call" && row.status === "complete").map(row => row.type === "jev_call" ? row.purpose : "")).toEqual(["classification", "routing"])
})

test("given source facts change during asynchronous admission, stale classification input never reaches HTTP", async () => {
  const f = fixture(), routing = f.make()
  f.duringClassificationAdmission(() => f.models([{ providerID: "fixture", id: "one", available: true, toolCall: true, contextLength: 64000 }]))
  await routing.classifier.prepare()
  expect(f.requests).toHaveLength(0)
  await routing.classifier.prepare()
  expect(f.requests).toHaveLength(1)
  const state = JSON.parse(f.requests[0]!.state) as { models: { evidence: { facts: { contextLength?: number } }[] }[] }
  expect(state.models[0]!.evidence[0]!.facts.contextLength).toBe(64000)
})


test("automatic research withholds unknown models and old sparse profiles until sourced knowledge arrives", async () => {
  const f = fixture(), model = { providerID: "fixture", id: "one" }
  await f.make().classifier.prepare()
  expect(f.requests).toHaveLength(1)
  const waiting = f.make(true)
  await waiting.classifier.prepare()
  expect(f.requests).toHaveLength(1)
  expect(waiting.classifier.memberships(model)).toBeUndefined()
  f.research("Official documentation describes coding and research strengths.")
  await waiting.classifier.prepare()
  expect(f.requests).toHaveLength(2)
  expect(waiting.classifier.memberships(model)).toHaveLength(6)
  const input = JSON.parse(f.requests[1]!.state) as { models: { evidence: { facts: { summary?: string } }[] }[] }
  expect(input.models[0]!.evidence.some(row => row.facts.summary?.includes("coding"))).toBe(true)
})
