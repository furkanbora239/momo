import { readFile } from "node:fs/promises"
import { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"

type JsonRecord = Record<string, unknown>

export async function proveNativeRoutingAccounting(options: {
  client: ReturnType<typeof OpenCode.make>; directory: string; modelLog: string; jevLog: string; restart(): Promise<void>; canonical?: boolean; scenario?: "paid" | "unknown" | "no-send"
}) {
  const { client, directory } = options
  async function run(prompt: string) {
    const session = await client.session.create({ location: { directory }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
    await client.session.prompt({ sessionID: session.id, text: prompt })
    await client.session.wait({ sessionID: session.id })
    return session.id
  }
  async function rows(path: string): Promise<JsonRecord[]> { return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as JsonRecord) }
  async function ledger() {
    const rpc = await client.rpc.call({ rpcID: "momo.native", method: "exportDecisions", input: {}, location: { directory } })
    const envelope = rpc as { output?: unknown }
    const payload = (envelope.output ?? rpc) as { lines: string[] }
    return payload.lines.map(line => JSON.parse(line) as JsonRecord)
  }
  const scenario = options.scenario ?? "paid"
  const decisions = async () => (await ledger()).filter(row => row.type === "decision")
  const budgetReason = scenario === "unknown" ? "jev monthly spend is unknown; Jev paused for budget safety" : "jev monthly budget cap reached"
  const firstSessionID = await run("MOMO_NATIVE_ACCOUNTING_FIRST")
  const firstRows = await decisions()
  const latest = new Map(firstRows.map(row => [row.decisionId, row]))
  const first = [...latest.values()].find(row => (row.request as { input?: { prompt?: string } }).input?.prompt === "MOMO_PAID_MALFORMED")
  const blocked = [...latest.values()].find(row => (row.request as { input?: { prompt?: string } }).input?.prompt === "MOMO_BUDGET_AFTER_FAILURE")
  const usage = first?.jevUsage as { inputTokens?: number; costUsd?: number } | undefined
  if (scenario === "paid" && (!first?.jevAttempted || first?.jevAnswer || !(usage?.costUsd && usage.costUsd >= 0.000001) || !(usage?.inputTokens && usage.inputTokens >= 100))) throw new Error("Paid malformed native response did not retain source-reported billing")
  if (scenario === "unknown" && (!first?.jevAttempted || first?.jevAnswer || usage?.costUsd !== undefined)) throw new Error("Missing provider input usage was treated as known spend")
  if (scenario === "no-send" && (!first || first.jevAttempted || first.jevUsage !== undefined)) throw new Error("Unbound manager admission invented a paid provider attempt")
  if (scenario !== "no-send" && blocked?.reason !== budgetReason) throw new Error("Native budget did not pause after paid malformed response")
  const jevBeforeRestart = await rows(options.jevLog).catch(error => { if (scenario === "no-send" && error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error })
  await options.restart()
  const recoveredSessionID = await run("MOMO_NATIVE_ACCOUNTING_RESTART")
  const afterRows = await decisions()
  const recovered = afterRows.find(row => (row.request as { input?: { prompt?: string } }).input?.prompt === "MOMO_BUDGET_AFTER_RESTART" && (scenario === "no-send" ? row.jevAttempted !== true : row.reason === budgetReason))
  const jevAfterRestart = await rows(options.jevLog).catch(error => { if (scenario === "no-send" && error instanceof Error && "code" in error && error.code === "ENOENT") return []; throw error })
  if (!recovered || jevAfterRestart.length !== jevBeforeRestart.length) throw new Error("Server restart bypassed durable billing or replayed Jev")
  const proofs = (await rows(options.modelLog)).flatMap(row => Array.isArray(row.messages) ? row.messages as JsonRecord[] : []).filter(message => message.role === "tool" && JSON.stringify(message.content).includes("MOMO_ACCOUNTING_TOOL_PROOF"))
  const values = proofs.map(message => typeof message.content === "string" ? JSON.parse(message.content) as JsonRecord : {})
  if (!values.some(value => typeof value.first === "string" && typeof value.second === "string") || !values.some(value => typeof value.task === "string")) throw new Error("Accounting proof absent from actual native Code Mode tool responses before/after restart")
  let canonical: unknown
  if (options.canonical) {
    const all = await ledger()
    const calls = all.filter(row => row.type === "jev_call")
    const latestCalls = new Map(calls.map(row => [row.callId, row]))
    if (scenario === "no-send") {
      if (latestCalls.size !== 3 || [...latestCalls.values()].some(call => call.status !== "not_sent" || call.usage !== undefined) || jevAfterRestart.length) throw new Error("Unbound manager admission sent HTTP or retained a paid/unknown canonical charge")
    } else {
      const call = latestCalls.get(first?.jevCallId)
      if (latestCalls.size !== 1 || call?.status !== "complete" || call?.purpose !== "routing" || JSON.stringify(call.usage) !== JSON.stringify(first?.jevUsage) || jevAfterRestart.length !== 1) throw new Error("Canonical call receipt differs from routing usage or was duplicated after restart")
    }
    canonical = { exportedCallVersions: calls.length, distinctCalls: latestCalls.size, latest: [...latestCalls.values()] }
  }
  return { scenario, canonical, firstSessionID, recoveredSessionID, sourceUsage: usage, jevBeforeRestart: jevBeforeRestart.length, jevAfterRestart: jevAfterRestart.length, exportedVersions: afterRows.length, proofs, cases: [`${scenario} native selection preserves authoritative billing/admission`, "budget paused without fallback", "real server restart retained billing without Jev replay", "historical decision versions exported", ...(options.canonical ? ["canonical shared call exports match route receipt without double counting"] : [])] }
}
