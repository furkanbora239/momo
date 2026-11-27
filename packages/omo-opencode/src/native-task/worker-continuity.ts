// MODIFIED: carry an ordinary worker assignment across one proven provider rejection.
import { isNativeModelRejectionHint } from "../native-catalog/model-continuity-evidence"
import { observeNativeExecutionFailure } from "./failure-observation"
import { sameModel } from "./guards"
import { errorText } from "./lifecycle"
import type { NativeTask, NativeTaskEngineOptions } from "./types"

export function createWorkerContinuity(deps: {
  options: NativeTaskEngineOptions
  now(): number
  save(task: NativeTask): Promise<NativeTask>
  recordRejectedOutcome(task: NativeTask): Promise<void>
}) {
  async function observe(task: NativeTask, error: string): Promise<boolean> {
    if (!deps.options.router.selectWorkerReplacement || task.kind !== "task" || task.role !== "worker" || task.maintenance ||
        task.state !== "running" || task.attempts !== 1 || !task.sessionID || !task.model || !task.decisionId ||
        task.childTaskIDs.length > 0 || task.question || !isNativeModelRejectionHint(error)) return false
    task.pendingWorkerFailure ??= { error, observedAt: deps.now() }
    await deps.save(task)
    await advance(task)
    return true
  }

  async function advance(task: NativeTask): Promise<void> {
    const pending = task.pendingWorkerFailure
    const { sessionID, model, decisionId } = task
    if (!pending || task.state !== "running" || !sessionID || !model || !decisionId) return
    const expired = deps.now() >= pending.observedAt + 90_000
    try {
      const receipt = await deps.options.runtime.inspect(sessionID)
      if (receipt.state !== "failed" || !receipt.failureID || !receipt.failureRejection ||
          !sameModel(receipt.failureModel, model) || receipt.failureAt === undefined) {
        if (expired) await fail(task, "OpenCode could not confirm the provider rejected the original request before work began.")
        return
      }
      const rejection = receipt.failureRejection
      await observeNativeExecutionFailure(task, pending.error, { onExecutionFailure: deps.options.onExecutionFailure, save: deps.save })
      if (task.failureObservationError) {
        if (expired) await fail(task, "The observed provider cooldown could not be saved. Review provider availability before creating another task.")
        return
      }
      if (!receipt.rejectedBeforeWork || task.toolStarted || task.activeTools.length || task.question || task.childTaskIDs.length) {
        await fail(task, "The original worker may have started work. Inspect its session and existing changes before continuing.")
        return
      }
      const replacement = await deps.options.router.selectWorkerReplacement?.({
        decisionId, taskID: task.id, sessionID, callerSessionID: task.parentSessionID, excludeProvider: rejection.scope === "provider",
      })
      if (replacement?.kind !== "selected" || replacement.role !== "worker") {
        const action = rejection.kind === "payment_required" ? "Check provider funding or your model pool." : "Wait for the cooldown or adjust your model pool."
        const reason = replacement?.kind === "unavailable" ? replacement.reason : "No automatic replacement was available."
        await fail(task, `${reason} ${action}`)
        return
      }
      await deps.recordRejectedOutcome(task)
      if (task.outcomeStatus !== "recorded") {
        if (expired) await fail(task, "The original attempt could not be recorded. Inspect its session before creating another task.")
        return
      }
      task.failedWorkerAttempt = { model, sessionID, decisionId, failureID: receipt.failureID, reason: rejection.kind, failedAt: receipt.failureAt }
      task.state = "queued"
      task.pendingWorkerFailure = undefined
      task.error = undefined
      task.result = undefined
      task.sessionID = undefined
      task.model = replacement.model
      task.decisionId = replacement.decisionId
      task.replacementStart = "pending"
      task.lastExecutionSequence = undefined
      task.processedEventIDs = []
      task.progress = undefined
      task.activeTools = []
      task.dispatchStatus = undefined
      task.dispatchError = undefined
      task.outcomeStatus = undefined
      task.outcomeError = undefined
      task.usage = undefined
      task.usageError = undefined
      await deps.save(task)
    } catch (error) {
      if (expired) await fail(task, `Replacement could not be prepared. Inspect the original session before creating another task. ${errorText(error)}`)
    }
  }

  async function fail(task: NativeTask, reason: string): Promise<void> {
    const original = task.pendingWorkerFailure?.error
    task.pendingWorkerFailure = undefined
    task.state = "failed"
    task.error = original ? `${original} ${reason}` : reason
    task.result = `Task failed: ${task.error}`
    task.delivery = { status: "pending", attempts: 0 }
    await deps.save(task)
  }

  return { observe, advance }
}
