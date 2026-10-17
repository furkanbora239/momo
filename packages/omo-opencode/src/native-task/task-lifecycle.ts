import { applyRoute, routeInput } from "./guards"
import { handleNativeTaskEvent } from "./events"
import { markNativeExecutionFailurePending } from "./failure-observation"
import { errorText } from "./lifecycle"
import type { NativeTask, NativeTaskEngineOptions, NativeTaskEvent } from "./types"

type TaskLifecycleOptions = {
  options: NativeTaskEngineOptions
  now: () => number
  get: (taskID: string) => Promise<NativeTask>
  save: (task: NativeTask) => Promise<NativeTask>
  withTaskLock: <T>(taskID: string, action: () => Promise<T>) => Promise<T>
  inPlaceLeases: Set<string>
  pump: () => Promise<void>
  controls: {
    deliver(taskID: string): Promise<NativeTask>
    deliverQuestion(task: NativeTask): Promise<void>
    resume(taskID: string, callerSessionID: string): Promise<NativeTask>
  }
  retryChildWake: (task: NativeTask) => Promise<void>
  recordOutcome: (task: NativeTask) => Promise<void>
  retryRouterRecords: (task: NativeTask) => Promise<void>
  finishFromInspection: (task: NativeTask, result: { state: "succeeded" | "failed"; result?: string; error?: string }) => Promise<void>
  failMissingSession: (task: NativeTask) => Promise<void>
  linkToParent: (task: NativeTask) => Promise<void>
}

export function createNativeTaskLifecycle(deps: TaskLifecycleOptions) {
  async function observeFailedTask(task: NativeTask): Promise<void> {
    if (task.state !== "failed" || !task.sessionID || !deps.options.onExecutionFailure) return
    await deps.withTaskLock(task.id, async () => {
      const current = await deps.get(task.id)
      if (current.error === undefined || current.failureObservationError !== undefined) return
      markNativeExecutionFailurePending(current, current.error)
      if (current.failureObservationError !== undefined) await deps.save(current)
    })
    let observationError: string | undefined
    try {
      const inspection = await deps.options.runtime.inspect(task.sessionID)
      const failure = inspection.state === "failed" ? inspection.error ?? task.error : task.error
      if (failure !== undefined) await deps.options.onExecutionFailure(task, failure)
    } catch (error) { observationError = errorText(error) }
    await deps.withTaskLock(task.id, async () => {
      const current = await deps.get(task.id)
      if (current.failureObservationError === observationError) return
      current.failureObservationError = observationError
      await deps.save(current)
    })
  }

  async function reconcile(): Promise<void> {
    for (const stored of await deps.options.repository.list()) {
      if (stored.parentTaskID !== undefined) await deps.linkToParent(stored)
      if (stored.state === "queued" && stored.routeStatus === "pending") {
        await deps.withTaskLock(stored.id, async () => {
          const current = await deps.get(stored.id)
          const routed = current.maintenance
            ? current.model && deps.options.router.bindResearch
              ? await deps.options.router.bindResearch({ ...routeInput(current), sourceDecisionID: current.sourceDecisionID }, current.model)
              : { kind: "unavailable" as const, reason: "Maintenance executor assignment missing during recovery" }
            : await deps.options.router.route(routeInput(current))
          applyRoute(current, routed)
          await deps.save(current)
        })
      }
      const beforeInspect = await deps.get(stored.id)
      await observeFailedTask(beforeInspect)
      const queuedInPlaceResume = beforeInspect.state === "queued" && beforeInspect.resumeInPlace === true
      const inspectExistingSession = beforeInspect.state === "running" || beforeInspect.state === "waiting_children" || queuedInPlaceResume
      if (inspectExistingSession && beforeInspect.sessionID !== undefined) {
        await deps.withTaskLock(stored.id, async () => {
          const current = await deps.get(stored.id)
          const inspection = await deps.options.runtime.inspect(current.sessionID ?? "")
          if (inspection.state === "running") {
            if (current.state === "queued" && current.resumeInPlace === true) deps.inPlaceLeases.add(current.id)
            return
          }
          if (inspection.state === "succeeded") await deps.finishFromInspection(current, { state: "succeeded", result: inspection.result })
          else if (inspection.state === "failed") await deps.finishFromInspection(current, { state: "failed", error: inspection.error, result: inspection.result })
          else if (inspection.state === "missing") await deps.failMissingSession(current)
          else {
            current.state = "interrupted"
            current.resumeInPlace = undefined
            current.waitForTaskID = undefined
            await deps.save(current)
          }
        })
      }
      if (beforeInspect.state === "running" && beforeInspect.sessionID === undefined) {
        await deps.withTaskLock(stored.id, async () => {
          const current = await deps.get(stored.id)
          if (current.state !== "running" || current.sessionID !== undefined) return
          current.state = "queued"
          await deps.save(current)
        })
      }
      const reconciled = await deps.get(stored.id)
      if (reconciled.state === "interrupted" && reconciled.sessionID !== undefined && !reconciled.maintenance) await deps.controls.resume(stored.id, reconciled.parentSessionID)
      if (reconciled.state === "interrupted" && reconciled.sessionID === undefined) {
        await deps.withTaskLock(stored.id, async () => {
          const current = await deps.get(stored.id)
          if (current.state !== "interrupted") return
          current.state = "queued"
          await deps.save(current)
        })
      }
      let latest = await deps.get(stored.id)
      if (latest.state === "waiting_question" && latest.answerStatus === "pending") {
        await deps.withTaskLock(latest.id, async () => {
          const current = await deps.get(latest.id)
          if (current.state === "waiting_question" && current.answerStatus === "pending") {
            current.state = "queued"
            await deps.save(current)
          }
        })
        latest = await deps.get(stored.id)
      }
      if (latest.questionDelivery === "pending" && latest.question !== undefined) await deps.controls.deliverQuestion(latest)
      if (latest.questionEscalationStatus === "pending" && latest.question !== undefined) await deliverEscalation(latest)
      if (latest.delivery?.status === "pending") await deps.controls.deliver(latest.id)
      if (latest.childrenWakePending) await deps.retryChildWake(latest)
      await deps.withTaskLock(latest.id, async () => deps.retryRouterRecords(await deps.get(latest.id)))
    }
    await deps.pump()
  }

  async function onEvent(event: NativeTaskEvent): Promise<void> {
    const task = (await deps.options.repository.list()).find((candidate) => candidate.sessionID === event.sessionID)
    if (task === undefined) return
    let effectiveEvent = event
    if (event.type === "execution.succeeded" && event.result === undefined) {
      const inspected = await deps.options.runtime.inspect(event.sessionID)
      if (inspected.result !== undefined) effectiveEvent = { ...event, result: inspected.result }
    }
    await deps.withTaskLock(task.id, async () => handleNativeTaskEvent(effectiveEvent, {
      repository: deps.options.repository,
      runtime: deps.options.runtime,
      save: deps.save,
      now: deps.now,
      questionTimeoutMs: deps.options.questionTimeoutMs ?? 120_000,
      onExecutionFailure: deps.options.onExecutionFailure,
    }))
    const latest = await deps.get(task.id)
    if (effectiveEvent.type === "question.asked") await deps.controls.deliverQuestion(latest)
    if (effectiveEvent.type === "execution.succeeded" || effectiveEvent.type === "execution.failed") {
      await deps.recordOutcome(latest)
      if (latest.parentTaskID !== undefined) await deps.retryChildWake(await deps.get(latest.parentTaskID))
    }
    if (effectiveEvent.type === "children.waiting") await deps.retryChildWake(latest)
    if (latest.delivery?.status === "pending") await deps.controls.deliver(latest.id)
    await deps.pump()
  }

  async function checkWatchdogs(): Promise<string[]> {
    const timeout = deps.options.silenceTimeoutMs ?? 180_000
    const activeToolTimeout = deps.options.activeToolTimeoutMs ?? 3_600_000
    const interrupted: string[] = []
    const recoverableTaskIDs = new Set<string>()
    let retriedFailureObservation = false
    for (const task of await deps.options.repository.list()) {
      if (task.failureObservationError !== undefined) {
        await observeFailedTask(task)
        retriedFailureObservation = true
      }
      await deps.withTaskLock(task.id, async () => {
        const current = await deps.get(task.id)
        if (current.questionDelivery === "pending" || current.questionEscalationStatus === "pending" || current.childrenWakePending || current.dispatchStatus === "pending" || ((current.state === "succeeded" || current.state === "failed") && current.outcomeStatus !== "recorded")) {
          recoverableTaskIDs.add(current.id)
        }
        if (current.state === "waiting_question" && !current.questionEscalated && current.questionDeadlineAt !== undefined && current.questionDeadlineAt <= deps.now() && current.question !== undefined) {
          current.questionEscalated = true
          current.questionEscalationStatus = "pending"
          await deps.save(current)
          recoverableTaskIDs.add(current.id)
          interrupted.push(`${current.id}:question`)
          return
        }
        if (current.state !== "running") return
        const oldestTool = current.activeTools.reduce<number | undefined>(
          (oldest, tool) => oldest === undefined || tool.startedAt < oldest ? tool.startedAt : oldest,
          undefined,
        )
        if (oldestTool !== undefined) {
          if (oldestTool + activeToolTimeout > deps.now()) return
          current.state = "interrupted"
          current.error = "Task exceeded the active tool timeout."
          await deps.save(current)
          if (current.sessionID !== undefined) await deps.options.runtime.interrupt({ sessionID: current.sessionID })
          interrupted.push(current.id)
          return
        }
        if (current.lastActivityAt + timeout > deps.now()) return
        current.state = "interrupted"
        current.error = "Task exceeded the silence timeout without active tools, a question, or child work."
        await deps.save(current)
        if (current.sessionID !== undefined) await deps.options.runtime.interrupt({ sessionID: current.sessionID })
        interrupted.push(current.id)
      })
    }
    for (const taskID of recoverableTaskIDs) {
      const current = await deps.get(taskID)
      if (current.questionDelivery === "pending" && current.question !== undefined) await deps.controls.deliverQuestion(current)
      if (current.questionEscalationStatus === "pending") await deliverEscalation(current)
      if (current.childrenWakePending) await deps.retryChildWake(current)
      await deps.withTaskLock(current.id, async () => deps.retryRouterRecords(await deps.get(current.id)))
    }
    if (retriedFailureObservation) await deps.pump()
    return interrupted
  }

  async function deliverEscalation(task: NativeTask): Promise<void> {
    const before = await deps.get(task.id)
    if (before.question === undefined || before.question.id !== task.question?.id || before.questionEscalationStatus !== "pending" || before.state !== "waiting_question" || before.answer !== undefined || before.questionEscalated !== true) return
    try {
      await deps.options.runtime.escalateQuestion({ rootSessionID: before.rootSessionID, taskID: before.id, question: before.question })
      await deps.withTaskLock(task.id, async () => {
        const current = await deps.get(task.id)
        if (current.question?.id !== before.question?.id || current.questionEscalationStatus !== "pending" || current.state !== "waiting_question" || current.answer !== undefined) return
        current.questionEscalationStatus = "sent"
        await deps.save(current)
      })
    } catch (error) {
      await deps.withTaskLock(task.id, async () => {
        const current = await deps.get(task.id)
        if (current.question?.id !== task.question?.id) return
        current.error = `Question escalation delivery failed: ${error instanceof Error ? error.message : String(error)}`
        await deps.save(current)
      })
    }
  }

  return { reconcile, onEvent, checkWatchdogs }
}
