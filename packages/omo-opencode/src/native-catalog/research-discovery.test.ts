import { expect, test } from "bun:test"
import { createNativeResearchDiscovery, isAutomaticResearchExecutor } from "./research-discovery"
import type { NativeCatalogModelFacts } from "./types"

const context = { decisionId: "discovery", rootSessionID: "maintenance", parentSessionID: "maintenance", parentRole: "orchestrator" }
const model: NativeCatalogModelFacts = { providerID: "provider", id: "known", available: true }

test("known source-backed cards never create maintenance context or requeue based on age", async () => {
  let contexts = 0
  let enqueues = 0
  const discovery = createNativeResearchDiscovery({ listModels: () => [model], isAllowed: () => true,
    knowledge: () => ({ model, known: true, source: "https://example.com/card", summary: "Coding model", verifiedAt: "2000-01-01T00:00:00Z" }),
    context: async () => { contexts++; return context }, enqueue: () => { enqueues++ },
  })
  expect(await discovery.discover()).toEqual({ scanned: 1, known: 1, unknown: 0, enqueued: 0, contextUnavailable: false })
  await discovery.discover()
  expect(contexts).toBe(0)
  expect(enqueues).toBe(0)
})

test("discovery enqueues only available allowed unknown models and deduplicates one scan", async () => {
  const enqueued: string[] = []
  let contexts = 0
  const unknown = { ...model, id: "new" }
  const discovery = createNativeResearchDiscovery({
    listModels: () => [model, unknown, unknown, { ...model, id: "disabled", available: false }, { ...model, id: "excluded" }],
    isAllowed: (candidate) => candidate.id !== "excluded",
    knowledge: (candidate) => candidate.id === "known" ? { model: candidate, known: true, source: "https://example.com/card", strengths: ["Research"] } : undefined,
    context: async () => { contexts++; return context }, enqueue: (candidate, received) => { expect(received).toEqual(context); enqueued.push(candidate.id) },
  })
  expect(await discovery.discover()).toEqual({ scanned: 2, known: 1, unknown: 1, enqueued: 1, contextUnavailable: false })
  expect(contexts).toBe(1)
  expect(enqueued).toEqual(["new"])
})

test("missing sources or empty cards remain unknown and missing context launches no work", async () => {
  let enqueues = 0
  const discovery = createNativeResearchDiscovery({ listModels: () => [model, { ...model, id: "empty" }], isAllowed: () => true,
    knowledge: (candidate) => ({ model: candidate, known: true, ...(candidate.id === "empty" ? { source: "https://example.com" } : { summary: "Unverified" }) }),
    context: async () => undefined, enqueue: () => { enqueues++ },
  })
  expect(await discovery.discover()).toMatchObject({ known: 0, unknown: 2, enqueued: 0, contextUnavailable: true })
  expect(enqueues).toBe(0)
})

test("concurrent discovery is single-flight and a failed scan can run again", async () => {
  let scans = 0
  let release: (() => void) | undefined
  const wait = new Promise<void>((resolve) => { release = resolve })
  const discovery = createNativeResearchDiscovery({ listModels: async () => { scans++; await wait; if (scans === 1) throw new Error("offline"); return [] },
    isAllowed: () => true, knowledge: () => undefined, context: async () => context, enqueue: () => {},
  })
  const first = discovery.discover()
  const second = discovery.discover()
  expect(first).toBe(second)
  release?.()
  const results = await Promise.allSettled([first, second])
  expect(results.map((result) => result.status)).toEqual(["rejected", "rejected"])
  expect(scans).toBe(1)
  expect(await discovery.discover()).toMatchObject({ scanned: 0 })
  expect(scans).toBe(2)
})


test("automatic executor rejects legacy, unknown and paid prices rather than assuming they are free", () => {
  const free = { providerID: "provider", id: "model", available: true, toolCall: true, priceSource: "models.dev" as const, priceCurrency: "USD" as const, priceOrigin: "https://models.dev/api.json", inputPricePerMillion: 0, outputPricePerMillion: 0 }
  expect(isAutomaticResearchExecutor(free)).toBe(true)
  expect(isAutomaticResearchExecutor({ ...free, priceSource: "provider" })).toBe(false)
  expect(isAutomaticResearchExecutor({ ...free, priceOrigin: "https://provider.test/old-price" })).toBe(false)
  expect(isAutomaticResearchExecutor({ ...free, outputPricePerMillion: undefined })).toBe(false)
  expect(isAutomaticResearchExecutor({ ...free, inputPricePerMillion: 1 })).toBe(false)
  expect(isAutomaticResearchExecutor({ ...free, available: false })).toBe(false)
  expect(isAutomaticResearchExecutor({ ...free, toolCall: false })).toBe(false)
})
