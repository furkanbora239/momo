import { readFile } from "node:fs/promises"
import { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"

type JsonRecord = Record<string, unknown>

export async function proveNativeRoutingAccounting(options: {
  client: ReturnType<typeof OpenCode.make>; directory: string; modelLog: string; jevLog: string; restart(): Promise<void>
}) {
  const { client, directory } = options
  async function run(prompt: string) {
    const session = await client.session.create({ location: { directory }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "momo-qa-model" } })
    await client.session.prompt({ sessionID: session.id, text: prompt })
    await client.session.wait({ sessionID: session.id })
    return session.id
  }
  async function rows(path: string): Promise<JsonRecord[]> { return (await readFile(path, "utf8")).trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as JsonRecord) }
  async function decisions() {
    const rpc = await client.rpc.call({ rpcID: "momo.native", method: "exportDecisions", input: {}, location: { directory } })
    const envelope = rpc as { output?: unknown }
    const payload = (envelope.output ?? rpc) as { lines: string[] }
    return payload.lines.map(line => JSON.parse(line) as JsonRecord).filter(row => row.type === "decision")
  }
  const firstSessionID = await run("MOMO_NATIVE_ACCOUNTING_FIRST")
  const firstRows = await decisions()
  const latest = new Map(firstRows.map(row => [row.decisionId, row]))
  const first = [...latest.values()].find(row => (row.request as { input?: { prompt?: string } }).input?.prompt === "MOMO_PAID_MALFORMED")
  const blocked = [...latest.values()].find(row => (row.request as { input?: { prompt?: string } }).input?.prompt === "MOMO_BUDGET_AFTER_FAILURE")
  const usage = first?.jevUsage as { inputTokens?: number; costUsd?: number } | undefined
  if (!first?.jevAttempted || first?.jevAnswer || !(usage?.costUsd && usage.costUsd >= 0.000001) || !(usage?.inputTokens && usage.inputTokens >= 100)) throw new Error("Paid malformed native response did not retain source-reported billing")
  if (blocked?.reason !== "jev monthly budget cap reached") throw new Error("Native budget did not pause after paid malformed response")
  const jevBeforeRestart = await rows(options.jevLog)
  await options.restart()
  const recoveredSessionID = await run("MOMO_NATIVE_ACCOUNTING_RESTART")
  const afterRows = await decisions()
  const recovered = afterRows.find(row => (row.request as { input?: { prompt?: string } }).input?.prompt === "MOMO_BUDGET_AFTER_RESTART" && row.reason === "jev monthly budget cap reached")
  const jevAfterRestart = await rows(options.jevLog)
  if (!recovered || jevAfterRestart.length !== jevBeforeRestart.length) throw new Error("Server restart bypassed durable billing or replayed Jev")
  const proofs = (await rows(options.modelLog)).flatMap(row => Array.isArray(row.messages) ? row.messages as JsonRecord[] : []).filter(message => message.role === "tool" && JSON.stringify(message.content).includes("MOMO_ACCOUNTING_TOOL_PROOF"))
  const values = proofs.map(message => typeof message.content === "string" ? JSON.parse(message.content) as JsonRecord : {})
  if (!values.some(value => typeof value.first === "string" && typeof value.second === "string") || !values.some(value => typeof value.task === "string")) throw new Error("Accounting proof absent from actual native Code Mode tool responses before/after restart")
  return { firstSessionID, recoveredSessionID, sourceUsage: usage, jevBeforeRestart: jevBeforeRestart.length, jevAfterRestart: jevAfterRestart.length, exportedVersions: afterRows.length, proofs, cases: ["paid malformed native selection retained billing", "budget paused without fallback", "real server restart retained billing without Jev replay", "historical decision versions exported"] }
}
