import { readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"

type Row = Record<string, unknown>
export async function proveBuiltNativeConsumption(input: {
  client: ReturnType<typeof OpenCode.make>; project: string; home: string
  release: () => void; blocked: () => string; workerCalls: () => number
  generations(sessionID: string): number; releaseWorkers(): void
  restart: (mutate: () => Promise<void>) => Promise<void>
}): Promise<Row> {
  const api = input.client
  let stage = "launch busy root"
  async function poll<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
    const end = Date.now() + 45000
    let last: unknown
    while (Date.now() < end) { const value = await read(); last = value; if (ready(value)) return value; await Bun.sleep(50) }
    throw new Error("Integrated consumption proof timed out: " + stage + " " + JSON.stringify(last))
  }
  async function tasks(rootSessionID: string): Promise<Row[]> {
    const response = await api.rpc.call({ rpcID: "momo.native", method: "tasks", input: { rootSessionID }, location: { directory: input.project } })
    const envelope = response as { output?: unknown }
    const value = (envelope.output ?? response) as { tasks?: unknown }
    if (!Array.isArray(value.tasks)) throw new Error("Native task RPC did not return raw tasks")
    return value.tasks as Row[]
  }
  async function launch(marker: string) {
    const session = await api.session.create({ location: { directory: input.project }, agent: "momo-orchestrator", model: { providerID: "momo-qa", id: "qa" } })
    const pending = api.session.prompt({ sessionID: session.id, text: marker })
    await poll(async () => input.blocked(), value => value === marker)
    return { session, pending }
  }
  const busy = await launch("CASE_INTEGRATED")
  stage = "busy child admission"
  const admitted = await poll(() => tasks(busy.session.id), rows => rows.some(row => row.prompt === "NATIVE_INTEGRATED_CHILD" && row.state === "succeeded" && (row.delivery as Row)?.status === "admitted"))
  const child = admitted.find(row => row.prompt === "NATIVE_INTEGRATED_CHILD")!
  input.release(); await busy.pending; await api.session.wait({ sessionID: busy.session.id })
  stage = "busy child consumption"
  const consumed = await poll(() => tasks(busy.session.id), rows => rows.some(row => row.id === child.id && (row.delivery as Row)?.status === "delivered"))
  const finalChild = consumed.find(row => row.id === child.id)!, receipt = finalChild.delivery as Row
  const context = await api.session.context({ sessionID: busy.session.id })
  if (receipt.receiptVersion !== 2 || context.filter(row => row.id === receipt.messageID).length !== 1 || (await api.session.inbox.list({ sessionID: busy.session.id })).length || finalChild.attempts !== child.attempts) throw new Error("Built plugin did not consume once without rerunning work")

  stage = "launch native form root"
  const questioning = await launch("CASE_FORM")
  stage = "native child question"
  const awaiting = await poll(() => tasks(questioning.session.id), rows => rows.some(row => row.prompt === "NATIVE_FORM_CHILD" && row.state === "waiting_question"))
  const questionChild = awaiting.find(row => row.prompt === "NATIVE_FORM_CHILD")!
  const forms = await poll(() => api.session.form.list({ sessionID: questioning.session.id }), values => values.some(form => form.metadata?.momoNativeTaskID === questionChild.id))
  const form = forms.find(value => value.metadata?.momoNativeTaskID === questionChild.id)!
  const answer = Object.fromEntries(form.fields.map(field => [field.key, field.type === "boolean" ? true : field.type === "integer" || field.type === "number" ? 1 : "approved"]))
  await api.session.form.reply({ sessionID: questioning.session.id, formID: form.id, answer })
  stage = "native form answer persistence"
  const answered = await poll(() => tasks(questioning.session.id), rows => rows.some(row => row.id === questionChild.id && row.answerStatus === "sent" && row.state === "succeeded"))
  const answeredChild = answered.find(row => row.id === questionChild.id)!
  const pendingInbox = await api.session.inbox.list({ sessionID: questioning.session.id })
  if (pendingInbox.some(row => row.type === "synthetic" && JSON.stringify(row.payload.metadata).includes("momoNativeQuestionNotification")) || JSON.stringify(answeredChild.answer) !== JSON.stringify(answer) || answeredChild.sessionID !== questionChild.sessionID) throw new Error("Built plugin left stale question notification or lost native field answer")
  input.release(); await questioning.pending; await api.session.wait({ sessionID: questioning.session.id })
  await poll(() => tasks(questioning.session.id), rows => rows.some(row => row.id === questionChild.id && (row.delivery as Row)?.status === "delivered"))
  if ((await api.session.inbox.list({ sessionID: questioning.session.id })).length || (await api.session.form.list({ sessionID: questioning.session.id })).length) throw new Error("Answered native root retained pending UI entries")

  stage = "department cancellation setup"
  const grouped = await launch("CASE_DEPARTMENT")
  const waiting = await poll(() => tasks(grouped.session.id), rows => rows.some(row => row.prompt === "NATIVE_DEPT_PARENT" && row.state === "waiting_children") && rows.filter(row => ["NATIVE_CANCEL_A", "NATIVE_CANCEL_B"].includes(String(row.prompt))).length === 2)
  const manager = waiting.find(row => row.prompt === "NATIVE_DEPT_PARENT")!
  const workers = waiting.filter(row => ["NATIVE_CANCEL_A", "NATIVE_CANCEL_B"].includes(String(row.prompt)))
  input.release(); await grouped.pending; await api.session.wait({ sessionID: grouped.session.id })
  const beforeGenerations = input.generations(String(manager.sessionID))
  stage = "two native worker cancellations and single aggregate"
  await api.session.prompt({ sessionID: grouped.session.id, text: "CASE_CANCEL CANCEL_IDS:" + workers.map(row => row.id).join(",") })
  await api.session.wait({ sessionID: grouped.session.id })
  const finalGroup = await poll(() => tasks(grouped.session.id), rows => rows.some(row => row.id === manager.id && row.state === "succeeded") && workers.every(worker => rows.some(row => row.id === worker.id && row.state === "cancelled" && (row.delivery as Row)?.status === "delivered")))
  input.releaseWorkers()
  const finalManager = finalGroup.find(row => row.id === manager.id)!, batch = finalManager.childrenBatch as Row
  const finalWorkers = workers.map(worker => finalGroup.find(row => row.id === worker.id)!)
  const managerContext = await api.session.context({ sessionID: String(manager.sessionID) })
  if (input.generations(String(manager.sessionID)) !== beforeGenerations + 1 || (await api.session.inbox.list({ sessionID: String(manager.sessionID) })).length || finalWorkers.some(worker => (worker.delivery as Row).messageID !== batch.messageID || !JSON.stringify(managerContext).includes(String(worker.result)) || !(batch.message as string).includes(String(worker.result)))) throw new Error("Built department lost child results or generated more than one aggregate report")
  const department = { parentTaskID: manager.id, children: 2, nativeAggregationGenerations: 1, aggregateMessageID: batch.messageID, receipts: finalWorkers.map(worker => worker.delivery), pendingInbox: 0, originalChildResultsPreserved: true }

  stage = "launch legacy root"
  const legacy = await launch("CASE_LEGACY")
  const old = await poll(() => tasks(legacy.session.id), rows => rows.some(row => row.prompt === "NATIVE_LEGACY_CHILD" && row.state === "succeeded" && (row.delivery as Row)?.status === "admitted"))
  const legacyChild = old.find(row => row.prompt === "NATIVE_LEGACY_CHILD")!, oldReceipt = legacyChild.delivery as Row
  await api.session.inbox.update({ sessionID: legacy.session.id, inboxID: String(oldReceipt.messageID), delivery: "queue" })
  const workerCalls = input.workerCalls()
  void legacy.pending.catch(error => { if (!(error instanceof Error)) throw error })
  await input.restart(async () => {
    const directory = join(input.home, ".omo/native/projects")
    let changed = false
    for (const entry of await readdir(directory)) {
      const path = join(directory, entry, "tasks.json")
      const stored = JSON.parse(await readFile(path, "utf8")) as { tasks: Row[] }
      const record = stored.tasks.find(row => row.id === legacyChild.id)
      if (!record) continue
      const receipt = record.delivery as Row
      receipt.status = "delivered"; receipt.deliveredAt = Date.now(); delete receipt.receiptVersion
      await writeFile(path, JSON.stringify(stored)); changed = true
    }
    if (!changed) throw new Error("Isolated legacy receipt mutation found no durable task")
  })
  stage = "legacy restart recovery"
  const recovered = await poll(() => tasks(legacy.session.id), rows => rows.some(row => row.id === legacyChild.id && (row.delivery as Row)?.status === "delivered" && (row.delivery as Row)?.receiptVersion === 2))
  await api.session.wait({ sessionID: legacy.session.id })
  const recoveredChild = recovered.find(row => row.id === legacyChild.id)!
  if (input.workerCalls() !== workerCalls || recoveredChild.sessionID !== legacyChild.sessionID || recoveredChild.attempts !== legacyChild.attempts || (await api.session.inbox.list({ sessionID: legacy.session.id })).length || (await api.session.context({ sessionID: legacy.session.id })).filter(row => row.id === oldReceipt.messageID).length !== 1) throw new Error("Legacy recovery duplicated work or left pending root delivery")
  return { status: "passed", runtime: "built-plugin", busyRoot: { taskID: child.id, admissionObserved: true, receipt, contextOccurrences: 1, pendingInbox: 0 }, nativeQuestion: { taskID: questionChild.id, persistedAnswer: answeredChild.answer, sameChildSession: true, pendingInbox: 0 }, department, legacyRestart: { taskID: legacyChild.id, sameChildSession: true, attempts: recoveredChild.attempts, workerCallsUnchanged: true, receipt: recoveredChild.delivery, pendingInbox: 0 } }
}
