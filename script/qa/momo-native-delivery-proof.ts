import type { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"

type Row = Record<string, unknown>
export async function proveNativeDeliveryRetries(input: {
  client: ReturnType<typeof OpenCode.make>
  directory: string
  providerID: string
  modelID: string
  tasks: (rootSessionID: string) => Promise<Row[]>
  faults: () => Promise<Array<{ kind: string; id: string; injected: boolean; parentBusy?: boolean }>>
}): Promise<Record<string, unknown>> {
  const root = await input.client.session.create({ location: { directory: input.directory }, agent: "momo-orchestrator", model: { providerID: input.providerID, id: input.modelID } })
  await input.client.session.prompt({ sessionID: root.id, text: "MOMO_TOOL_CREATE MOMO_TOOL_QUESTION" })
  await input.client.session.wait({ sessionID: root.id })
  const end = Date.now() + 45_000
  let child: Row | undefined
  while (Date.now() < end) {
    child = (await input.tasks(root.id)).find((row) => row.prompt === "MOMO_TOOL_QUESTION")
    if (child?.state === "waiting_question" && child.questionDelivery === "sent") break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (child?.state !== "waiting_question" || child.questionDelivery !== "sent") throw new Error(`Forwarded question did not retry successfully: ${JSON.stringify(child)}; faults=${JSON.stringify(await input.faults())}`)
  const forms = (await input.client.session.form.list({ sessionID: root.id })).filter((form) => form.metadata?.momoNativeTaskID === child?.id)
  if (forms.length !== 1) throw new Error(`Forwarded question has ${forms.length} forms`)
  const form = forms[0]!
  const field = form.fields[0]
  if (!field) throw new Error("Forwarded question has no answer field")
  await input.client.session.form.reply({ sessionID: root.id, formID: form.id, answer: { [field.key]: "approved" } })
  const completionDeadline = Date.now() + 15_000
  while (Date.now() < completionDeadline) {
    child = (await input.tasks(root.id)).find((row) => row.prompt === "MOMO_TOOL_QUESTION")
    if (child?.state === "succeeded" && (child.delivery as Row | undefined)?.status === "delivered") break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  if (child?.state !== "succeeded" || (child.delivery as Row | undefined)?.status !== "delivered") throw new Error("Answered child did not complete after delivery retry")
  const faults = await input.faults()
  for (const kind of ["form", "result"]) {
    const records = faults.filter((row) => row.kind === kind)
    const first = records.find((row) => row.injected)
    if (!first?.injected || !records.some((row) => !row.injected && row.id === first.id) || records.filter((row) => row.injected).length !== 1) throw new Error(`Retry did not preserve ${kind} identity`)
  }
  if (!faults.some((row) => row.kind === "result" && row.injected && row.parentBusy)) throw new Error("Result fault was not exercised while its parent was busy")
  const remainingForms = (await input.client.session.form.list({ sessionID: root.id })).filter((item) => item.metadata?.momoNativeTaskID === child?.id)
  if (remainingForms.length !== 0) throw new Error("Answered retry left a parent form open")
  const context = await input.client.session.context({ sessionID: root.id })
  const resultIDs = faults.filter((row) => row.kind === "result" && row.injected).map((row) => row.id)
  // The first result fault is exercised by the earlier pricing root, while this
  // question root verifies its own delivery is accepted once.
  const childMessageID = (child.delivery as Row).messageID
  if (context.filter((message) => message.id === childMessageID).length !== 1) throw new Error("Child result was duplicated or absent in parent context")
  return { status: "passed", injectedHttpStatus: 503, faultKinds: ["form", "result"], stableRetryIDs: true, resultRetriedAfterBusyParent: true, singleForwardedForm: true, answeredField: field.key, childState: child.state, childResultAcceptedOnce: true, forwardedFormsClosed: true, injectedResultIDs: resultIDs }
}
