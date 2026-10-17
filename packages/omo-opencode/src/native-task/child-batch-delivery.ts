import { errorText, isTerminal } from "./lifecycle"
import type { NativeTask, NativeTaskEngineOptions } from "./types"

type Dependencies = {
  options: NativeTaskEngineOptions
  get(taskID: string): Promise<NativeTask>
  save(task: NativeTask): Promise<NativeTask>
  withTaskLock<T>(taskID: string, operation: () => Promise<T>): Promise<T>
  retryChildWake(task: NativeTask): Promise<void>
}

export function createNativeChildBatchDelivery(deps: Dependencies) {
  /** The caller holds the parent lock; persist provenance before native inbox mutations. */
  async function prepare(parent: NativeTask): Promise<string[] | undefined> {
    const runtime = deps.options.runtime
    if (!parent.childrenWakePending || !parent.parentWakeMessage || !runtime.childrenWakeMessageID) return undefined
    const wakeID = parent.parentWakeID ?? parent.parentWakeMessage
    const messageID = runtime.childrenWakeMessageID(parent.id, wakeID)
    parent.childrenBatch = { messageID, wakeID, childTaskIDs: [...parent.childTaskIDs], message: parent.parentWakeMessage, status: "pending" }
    await deps.save(parent)
    for (const taskID of parent.childrenBatch.childTaskIDs) await deps.withTaskLock(taskID, async () => {
      const child = await deps.get(taskID)
      if (!isTerminal(child.state) || child.parentTaskID !== parent.id || child.parentSessionID !== parent.sessionID || child.delivery?.status === "delivered") return
      child.delivery = { ...child.delivery, receiptVersion: 2, aggregateTaskID: parent.id, originalMessageID: child.delivery?.originalMessageID ?? child.delivery?.messageID ?? runtime.deliveryMessageID?.(child.id), messageID, status: "admitted", attempts: child.delivery?.attempts ?? 0, deliveredAt: undefined }
      await deps.save(child)
    })
    return parent.childrenBatch.childTaskIDs
  }

  async function reconcile(taskID: string): Promise<void> {
    const parent = await deps.get(taskID), batch = parent.childrenBatch
    const runtime = deps.options.runtime
    if (!batch || !parent.sessionID || !runtime.inspectDelivery || batch.status === "delivered") return
    let observed: "missing" | "admitted" | "delivered"
    try {
      observed = await runtime.inspectDelivery({ parentSessionID: parent.sessionID, messageID: batch.messageID })
      if (observed === "admitted" && (await runtime.inspect(parent.sessionID)).state === "running") return
    } catch (error) {
      await deps.withTaskLock(parent.id, async () => {
        const current = await deps.get(parent.id)
        if (current.childrenBatch?.messageID === batch.messageID) { current.childrenBatch.lastError = errorText(error); await deps.save(current) }
      })
      return
    }
    let retry = false
    await deps.withTaskLock(parent.id, async () => {
      const current = await deps.get(parent.id)
      if (current.childrenBatch?.messageID !== batch.messageID || current.childrenBatch.status === "delivered") return
      if (observed === "delivered") {
        current.childrenBatch.status = "delivered"
        if (current.parentWakeID === batch.wakeID) { current.parentWakeMessage = undefined; current.parentWakeID = undefined; current.childrenWakePending = false }
      }
      else if (!isTerminal(current.state)) {
        current.parentWakeMessage = batch.message
        current.parentWakeID = batch.wakeID
        current.childrenWakePending = true
        current.state = "waiting_children"
        retry = true
      }
      await deps.save(current)
    })
    if (retry) await deps.retryChildWake(await deps.get(parent.id))
  }

  return { prepare, reconcile }
}
