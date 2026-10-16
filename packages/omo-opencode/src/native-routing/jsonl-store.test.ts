import { afterEach, describe, expect, test } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createJsonlNativeRouterStore } from "./jsonl-store"
import type { NativeCandidate, NativeDecisionRecord } from "./types"

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))) })
async function ledgerPath() { const root = await mkdtemp(join(tmpdir(), "momo-ledger-content-")); roots.push(root); return join(root, "ledger.jsonl") }
function record(): NativeDecisionRecord {
  const roles = ["planner", "executor", "reviewer", "worker", "explore", "librarian", "research", "catalog-researcher"] as const
  const candidates: NativeCandidate[] = roles.flatMap((role) => Array.from({ length: 53 }, (_, index) => {
    const model = { providerID: "fixture", id: `model-${index}` }
    return { role, model, facts: { ...model, available: true, toolCall: true }, knowledge: { model, known: true, summary: `facts-${index}-` + "x".repeat(100) } }
  }))
  return { version: 1, type: "decision", decisionId: "stable", createdAt: "2026-10-13T00:00:00Z", status: "awaiting_selection", request: { decisionId: "stable", input: { prompt: "work", parentRole: "orchestrator", rootSessionID: "root", parentSessionID: "root", kind: "task" }, allowedRoles: [...roles], candidates, knowledge: candidates.map((candidate) => candidate.knowledge), outcomes: [], instructions: "route" }, candidateSnapshots: [{ capturedAt: "2026-10-13T00:00:00Z", source: "initial", candidates }], choiceCandidates: candidates, jevFailure: { message: "fixture", rawResponse: { ref: "literal authored ref", version: 2, type: "content" } } }
}

describe("content-addressed native ledger", () => {
  test("deduplicates repeated facts while export preserves every record exactly", async () => {
    const path = await ledgerPath()
    const store = createJsonlNativeRouterStore(path)
    const base = record()
    const rows = Array.from({ length: 20 }, (_, index) => ({ ...base, reason: `revision-${index}` }))
    for (const row of rows) await store.append(row)
    const exported = await store.exportLines()
    expect(exported.map((line) => JSON.parse(line))).toEqual(rows)
    expect(Buffer.byteLength(await readFile(path, "utf8"))).toBeLessThan(exported.reduce((sum, line) => sum + Buffer.byteLength(line), 0) / 5)
    const recovered = await createJsonlNativeRouterStore(path).load()
    expect(recovered).toEqual([rows.at(-1)!])
    expect(recovered[0]?.type === "decision" ? recovered[0].request.candidates.length : 0).toBe(424)
  })

  test("appends to historical v1 ledgers without rewriting them", async () => {
    const path = await ledgerPath()
    const first = record()
    const original = JSON.stringify(first) + "\n"
    await writeFile(path, original)
    const store = createJsonlNativeRouterStore(path)
    await store.append({ ...first, reason: "new revision" })
    expect((await readFile(path, "utf8")).startsWith(original)).toBe(true)
    expect((await createJsonlNativeRouterStore(path).load())).toEqual([{ ...first, reason: "new revision" }])
    expect((await store.exportLines()).map((line) => JSON.parse(line))).toEqual([first, { ...first, reason: "new revision" }])
  })

  test("caller mutations and failed append cannot alter cached persisted records", async () => {
    const path = await ledgerPath()
    const store = createJsonlNativeRouterStore(path)
    const base = record()
    await store.append(base)
    const loaded = await store.load()
    const row = loaded[0]
    if (row?.type !== "decision") throw new Error("expected decision")
    Object.assign(row, { status: "completed" })
    Object.assign(row.request.candidates[0]!.facts, { available: false })
    expect(await store.load()).toEqual([base])
    const unpersisted = { ...row, reason: "not saved", circular: {} }
    unpersisted.circular = unpersisted
    await expect(store.append(unpersisted)).rejects.toThrow("not JSON serializable")
    expect(await store.load()).toEqual([base])
  })

  test("two concurrent store instances never cache an incomplete latest view", async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const path = await ledgerPath()
      const left = createJsonlNativeRouterStore(path)
      const right = createJsonlNativeRouterStore(path)
      const base = record()
      const other = { ...base, decisionId: "second", request: { ...base.request, decisionId: "second" } }
      await Promise.all([left.load(), right.load()])
      await Promise.all([left.append(base), right.append(other)])
      expect((await left.load()).map(row => row.type === "decision" ? row.decisionId : "breaker").sort()).toEqual(["second", "stable"])
      expect((await right.load()).map(row => row.type === "decision" ? row.decisionId : "breaker").sort()).toEqual(["second", "stable"])
    }
  })

  test("partial append and later external corruption both fail closed", async () => {
    const path = await ledgerPath()
    const store = createJsonlNativeRouterStore(path, { onMalformedRecord: () => undefined })
    await store.append(record())
    const saved = await readFile(path, "utf8")
    await writeFile(path, saved.split("\n").slice(0, -2).join("\n") + "\n")
    await expect(store.load()).rejects.toThrow("incomplete content transaction")
    await expect(store.exportLines()).rejects.toThrow("incomplete content transaction")
    await writeFile(path, saved + "{broken\n")
    await expect(store.load()).rejects.toThrow("corrupt active ledger")
  })

  test("rejects tampered content and missing references rather than permitting replay", async () => {
    for (const content of ['{"version":2,"type":"record","ref":"missing"}', '{"version":2,"type":"content","hash":"wrong","node":{"kind":"array","items":[]}}']) {
      const path = await ledgerPath()
      await writeFile(path, content + "\n")
      await expect(createJsonlNativeRouterStore(path, { onMalformedRecord: () => undefined }).load()).rejects.toThrow("corrupt active ledger")
    }
  })
})
