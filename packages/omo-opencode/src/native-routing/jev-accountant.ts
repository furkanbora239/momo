// MODIFIED: momo shares one durable paid-call queue between routing and catalog classification.
import { NativeJevAdmissionError } from "@oh-my-opencode/decision-core"
import { nativeJevFailureNotSent } from "./jev-adapter"
import { usageFromAttempts } from "./jev-http-usage"
import { legacyJevBilling } from "./jev-usage"
import type { NativeJevCallAudit, NativeJevCallRecord, NativeJevHttpAttempt, NativeRouterStore } from "./types"

export class NativeJevAccountingPersistenceError extends Error {
  constructor(error: unknown) { super(error instanceof Error ? error.message : String(error), { cause: error }); this.name = "NativeJevAccountingPersistenceError" }
}

export type NativeJevCallIdentity = Pick<NativeJevCallRecord, "callId" | "purpose" | "inputDigest">
export function createNativeJevAccountant(options: { readonly store: NativeRouterStore; readonly monthlyBudgetUsd?: number; readonly now?: () => number }) {
  const now = options.now ?? Date.now
  let queue = Promise.resolve(), poisoned: NativeJevAccountingPersistenceError | undefined
  const calls = new Map<string, NativeJevCallRecord>()
  let legacy: Awaited<ReturnType<NativeRouterStore["load"]>> = [], loaded = false
  async function load() {
    if (loaded) return
    const rows = await options.store.load()
    for (const row of rows) if (row.type === "jev_call") calls.set(row.callId, row)
    const decisions = new Map(rows.filter(row => row.type === "decision").map(row => [row.decisionId, row]))
    legacy = [...decisions.values()].filter(row => !row.jevCallId || !calls.has(row.jevCallId))
    loaded = true
  }
  function check(own?: NativeJevCallRecord): void {
    if (poisoned) throw new NativeJevAdmissionError("jev accounting persistence is uncertain")
    const month = new Date(now()).toISOString().slice(0, 7)
    let spend = 0, unknown = false
    for (const record of calls.values()) {
      if (record.createdAt.slice(0, 7) !== month || record.status === "not_sent") continue
      if (record.status === "pending" && record.callId !== own?.callId) unknown = true
      if (record.usage) { spend += record.usage.costUsd ?? 0; if (record.usage.costUsd === undefined) unknown = true }
      else if (record.status === "complete") unknown = true
    }
    for (const record of legacy) {
      if (record.type !== "decision" || record.createdAt.slice(0, 7) !== month) continue
      const historical = legacyJevBilling(record.jevFailure?.rawResponse)
      const answer = legacyJevBilling(record.jevAnswer)
      const audited = historical.audited ? historical : answer.audited ? answer : undefined
      const usage = record.jevUsage ?? (audited ? audited.usage : record.jevAnswer?.usage ?? historical.usage)
      if (record.jevCallId && (record.jevAttempted || record.jevAnswer || historical.attempted)) unknown = true
      spend += usage?.costUsd ?? 0
      if ((record.jevAttempted || record.jevAnswer || historical.attempted) && usage?.costUsd === undefined) unknown = true
    }
    if (unknown && options.monthlyBudgetUsd !== undefined) throw new NativeJevAdmissionError("jev monthly spend is unknown; Jev paused for budget safety")
    if (options.monthlyBudgetUsd !== undefined && spend >= options.monthlyBudgetUsd) throw new NativeJevAdmissionError("jev monthly budget cap reached")
  }
  async function persist(record: NativeJevCallRecord): Promise<void> {
    try { await options.store.append(record); calls.set(record.callId, record) }
    catch (error) { poisoned = new NativeJevAccountingPersistenceError(error); throw poisoned }
  }
  function run<T>(identity: NativeJevCallIdentity, execute: (audit: NativeJevCallAudit) => Promise<T>): Promise<{ value: T; receipt: NativeJevCallRecord }> {
    const operation = async () => {
      await load()
      if (!identity.callId || !/^[a-f0-9]{64}$/.test(identity.inputDigest)) throw new Error("invalid Jev call identity")
      const existing = calls.get(identity.callId)
      if (existing) throw new NativeJevAdmissionError(existing.inputDigest !== identity.inputDigest || existing.purpose !== identity.purpose ? "jev call identity conflicts with durable input" : "jev call already recorded; automatic replay refused")
      check()
      let receipt: NativeJevCallRecord = { version: 1, type: "jev_call", ...identity, createdAt: new Date(now()).toISOString(), status: "pending" }
      await persist(receipt)
      const attempts: NativeJevHttpAttempt[] = []
      let requests = 0
      const audit: NativeJevCallAudit = {
        async beforeRequest() { check(receipt); requests++ },
        async recordAttempt(attempt) {
          attempts.push(structuredClone(attempt))
          receipt = { ...receipt, usage: usageFromAttempts(attempts) }
          await persist(receipt)
        },
      }
      try {
        const value = await execute(audit)
        receipt = { ...receipt, status: "complete", usage: requests === attempts.length ? usageFromAttempts(attempts) : { ...usageFromAttempts(attempts), costUsd: undefined } }
        await persist(receipt)
        return { value, receipt }
      } catch (error) {
        if (poisoned) throw poisoned
        const notSent = requests === 0 && attempts.length === 0 && nativeJevFailureNotSent(error)
        receipt = { ...receipt, status: notSent ? "not_sent" : "complete", usage: notSent ? undefined : requests === attempts.length ? usageFromAttempts(attempts) : { ...usageFromAttempts(attempts), costUsd: undefined } }
        await persist(receipt)
        throw error
      }
    }
    const next = queue.then(operation, operation)
    queue = next.then(() => undefined, () => undefined)
    return next
  }
  return { run, receipt: (callId: string) => { const receipt = calls.get(callId); return receipt ? structuredClone(receipt) : undefined } }
}
export type NativeJevAccountant = ReturnType<typeof createNativeJevAccountant>
