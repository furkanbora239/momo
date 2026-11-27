// MODIFIED: carry an ordinary worker assignment across one proven provider rejection.
import { isNativeModelRejectionHint } from "../native-catalog/model-continuity-evidence"
import { observeNativeExecutionFailure } from "./failure-observation"
import { sameModel } from "./guards"
import { errorText } from "./lifecycle"
import type { NativeTask, NativeTaskEngineOptions, NativeRouteResult } from "./types"

const MAX_RETRY_WAIT_MS = 15 * 60_000
const RETRY_RECOVERY_WINDOW_MS = 2 * 60_000

export function workerRetryDeadline(retryAt: number | undefined): number | undefined {
  return retryAt === undefined ? undefined : retryAt + RETRY_RECOVERY_WINDOW_MS
}

function retryExpired(retryAt: number | undefined, now: number): boolean {
  const deadline = workerRetryDeadline(retryAt)
  return deadline !== undefined && now >= deadline
}

type WorkerSelection = Extract<NativeRouteResult, { kind: "selected" }>

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
          !sameModel(receipt.failureModel, model) || receipt.failureAt === undefined ||
          !Number.isFinite(receipt.failureAt) || receipt.failureAt <= 0 || receipt.failureAt > deps.now()) {
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
      const selected = replacement?.kind === "selected" && replacement.role === "worker" ? replacement : undefined
      const retryAt = rejection.kind === "rate_limit" && rejection.explicitRetryAfter && rejection.retryAfterMs <= MAX_RETRY_WAIT_MS
        ? receipt.failureAt + rejection.retryAfterMs : undefined
      const canWait = retryAt !== undefined && !retryExpired(retryAt, deps.now())
      if (!selected && !canWait) {
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
      task.lastExecutionSequence = undefined
      task.processedEventIDs = []
      task.progress = undefined
      task.activeTools = []
      if (selected) prepareLaunch(task, selected)
      else task.workerRetryAt = retryAt
      await deps.save(task)
    } catch (error) {
      if (expired) await fail(task, `Replacement could not be prepared. Inspect the original session before creating another task. ${errorText(error)}`)
    }
  }

  async function startScheduled(task: NativeTask): Promise<"ready" | "pending" | "failed"> {
    const attempt = task.failedWorkerAttempt
    const retryAt = task.workerRetryAt
    if (!attempt || retryAt === undefined || task.state !== "queued" || deps.now() < retryAt) return "pending"
    if (retryExpired(retryAt, deps.now())) {
      await fail(task, "The provider retry window expired. Check availability before creating another task.")
      return "failed"
    }
    let result: NativeRouteResult | undefined
    try {
      result = await deps.options.router.selectWorkerReplacement?.({
        decisionId: attempt.decisionId, taskID: task.id, sessionID: attempt.sessionID, callerSessionID: task.parentSessionID,
        excludeProvider: false, retryOriginal: true,
      })
    } catch (error) {
      task.error = errorText(error)
      await deps.save(task)
      return "pending"
    }
    if (retryExpired(retryAt, deps.now())) {
      await fail(task, "The provider retry window expired. Check availability before creating another task.")
      return "failed"
    }
    if (result?.kind !== "selected" || result.role !== "worker") {
      const reason = result?.kind === "unavailable" ? result.reason : "The provider retry was unavailable."
      await fail(task, `${reason} Check availability and pool settings.`)
      return "failed"
    }
    prepareLaunch(task, result)
    await deps.save(task)
    return "ready"
  }

  function prepareLaunch(task: NativeTask, selection: WorkerSelection): void {
    task.model = selection.model
    task.decisionId = selection.decisionId
    task.replacementStart = "pending"
    task.dispatchStatus = undefined
    task.dispatchError = undefined
    task.outcomeStatus = undefined
    task.outcomeError = undefined
    task.usage = undefined
    task.usageError = undefined
    task.error = undefined
  }

  async function fail(task: NativeTask, reason: string): Promise<void> {
    const original = task.pendingWorkerFailure?.error
    task.pendingWorkerFailure = undefined
    task.workerRetryAt = undefined
    task.state = "failed"
    task.error = original ? `${original} ${reason}` : reason
    task.result = `Task failed: ${task.error}`
    task.delivery = { status: "pending", attempts: 0 }
    await deps.save(task)
  }

  return { observe, advance, startScheduled }
}
