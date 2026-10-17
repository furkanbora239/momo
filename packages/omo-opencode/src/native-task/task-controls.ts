import { errorText, isTerminal } from "./lifecycle"
import { applyRoute } from "./guards"
import type { NativeModelRef, NativeTask, NativeTaskEngineOptions, NativeTaskRole } from "./types"

type TaskControlsOptions = {
  options: NativeTaskEngineOptions
  now: () => number
  get: (taskID: string) => Promise<NativeTask>
  save: (task: NativeTask) => Promise<NativeTask>
  withTaskLock: <T>(taskID: string, action: () => Promise<T>) => Promise<T>
  pump: () => Promise<void>
  wakeParentForQuestion: (childTaskID: string, questionID: string) => Promise<boolean>
  releaseWaitSlot: (taskID: string, callerSessionID: string) => Promise<string | undefined>
  resumeWaitSlot: (parentTaskID: string, taskID: string) => Promise<void>
  recordOutcome: (task: NativeTask) => Promise<void>
  retryChildWake: (task: NativeTask) => Promise<void>
  finishFromInspection: (task: NativeTask, result: { state: "succeeded" | "failed"; result?: string; error?: string }) => Promise<void>
  failMissingSession: (task: NativeTask) => Promise<void>
}

export function createNativeTaskControls(deps: TaskControlsOptions) {
  const deliveriesInFlight = new Set<string>()
  const questionsInFlight = new Set<string>()

  async function select(taskID: string, callerSessionID: string, model: NativeModelRef, role: NativeTaskRole): Promise<NativeTask> {
    await deps.withTaskLock(taskID, async () => {
      const task = await deps.get(taskID)
      if (task.state !== "awaiting_selection" || task.decisionId === undefined) throw new Error("Task is not awaiting selection")
      authorizeTask(task, callerSessionID, false)
      const routed = await deps.options.router.select(task.decisionId, model, role, callerSessionID)
      if (routed.kind === "awaiting_selection") {
        task.decisionId = routed.decisionId
        task.candidates = routed.candidates
        task.error = routed.reason
        await deps.save(task)
        return
      }
      applyRoute(task, routed)
      await deps.save(task)
    })
    if ((await deps.get(taskID)).state === "queued") await deps.pump()
    return deps.get(taskID)
  }

  async function resume(taskID: string, callerSessionID: string): Promise<NativeTask> {
    let shouldPump = false
    await deps.withTaskLock(taskID, async () => {
      const task = await deps.get(taskID)
      authorizeTask(task, callerSessionID)
      if (task.state !== "interrupted" && task.state !== "running") throw new Error("Only running or interrupted tasks can resume")
      if (task.sessionID === undefined) {
        task.state = "queued"
        await deps.save(task)
        shouldPump = true
        return
      }
      const inspection = await deps.options.runtime.inspect(task.sessionID)
      if (inspection.state === "running") return
      if (inspection.state === "succeeded") {
        await deps.finishFromInspection(task, { state: "succeeded", result: inspection.result })
        return
      }
      if (inspection.state === "failed") {
        await deps.finishFromInspection(task, { state: "failed", error: inspection.error, result: inspection.result })
        return
      }
      if (inspection.state === "missing") {
        await deps.failMissingSession(task)
        return
      }
      task.state = "queued"
      task.activeTools = []
      await deps.save(task)
      shouldPump = true
    })
    const latest = await deps.get(taskID)
    if (shouldPump) await deps.pump()
    if (latest.delivery?.status === "pending") await deliver(taskID)
    return deps.get(taskID)
  }

  async function answer(taskID: string, callerSessionID: string, questionID: string, value: unknown): Promise<NativeTask> {
    await deps.withTaskLock(taskID, async () => {
      const task = await deps.get(taskID)
      if (task.state !== "waiting_question" || task.question?.id !== questionID) throw new Error("Task is not waiting for that question")
      if (task.parentSessionID !== callerSessionID && !(task.questionEscalated && task.rootSessionID === callerSessionID)) throw new Error("Question must be answered from the originating parent or escalated root session")
      if (task.answer !== undefined) throw new Error("Question already has an answer")
      if (task.sessionID === undefined) throw new Error("Question task has no child session")
      task.answer = value
      task.answerStatus = "pending"
      task.questionDelivery = "sent"
      task.questionEscalationStatus = undefined
      task.questionDeadlineAt = undefined
      task.lastActivityAt = deps.now()
      task.state = "queued"
      await deps.save(task)
    })
    await deps.pump()
    return deps.get(taskID)
  }

  async function cancel(taskID: string, callerSessionID: string): Promise<NativeTask> {
    let sessionID: string | undefined
    let childTaskIDs: string[] = []
    let snapshot: NativeTask | undefined
    let wasAlreadyTerminal = false
    await deps.withTaskLock(taskID, async () => {
      const task = await deps.get(taskID)
      authorizeTask(task, callerSessionID)
      if (isTerminal(task.state)) { wasAlreadyTerminal = true; snapshot = task; return }
      sessionID = task.sessionID
      childTaskIDs = [...task.childTaskIDs]
      task.state = "cancelled"
      task.activeTools = []
      task.result = `Task ${task.id} was cancelled.`
      task.delivery = { status: "pending", attempts: 0 }
      snapshot = await deps.save(task)
    })
    if (snapshot === undefined) throw new Error("Task disappeared during cancellation")
    if (wasAlreadyTerminal) return snapshot
    if (sessionID !== undefined) await deps.options.runtime.interrupt({ sessionID })
    for (const childID of childTaskIDs) await cancelInternal(childID)
    if (snapshot.parentTaskID !== undefined) await deps.retryChildWake(await deps.get(snapshot.parentTaskID))
    await deliver(taskID)
    return deps.get(taskID)
  }

  async function cancelInternal(taskID: string): Promise<void> {
    let sessionID: string | undefined
    let children: string[] = []
    await deps.withTaskLock(taskID, async () => {
      const task = await deps.get(taskID)
      if (isTerminal(task.state)) return
      sessionID = task.sessionID
      children = [...task.childTaskIDs]
      task.state = "cancelled"
      task.activeTools = []
      task.result = `Task ${task.id} was cancelled.`
      task.delivery = { status: "pending", attempts: 0 }
      await deps.save(task)
    })
    if (sessionID !== undefined) await deps.options.runtime.interrupt({ sessionID })
    for (const childID of children) await cancelInternal(childID)
  }

  async function deliver(taskID: string): Promise<NativeTask> {
    if (deliveriesInFlight.has(taskID)) return deps.get(taskID)
    deliveriesInFlight.add(taskID)
    try {
      let delivery: { parentSessionID: string; taskID: string; result: string } | undefined
      await deps.withTaskLock(taskID, async () => {
        const task = await deps.get(taskID)
        if (task.maintenance) { task.delivery = undefined; await deps.save(task); return }
        if (task.delivery?.status !== "pending" || task.result === undefined) return
        task.delivery.attempts += 1
        task.delivery.messageID ??= deps.options.runtime.deliveryMessageID?.(task.id)
        task.delivery.attemptedAt = deps.now()
        delivery = { parentSessionID: task.parentSessionID, taskID: task.id, result: task.result }
        await deps.save(task)
      })
      if (delivery === undefined) return deps.get(taskID)
      let failure: string | undefined
      try { await deps.options.runtime.deliver(delivery) } catch (error) { failure = errorText(error) }
      await deps.withTaskLock(taskID, async () => {
        const task = await deps.get(taskID)
        if (task.delivery?.status !== "pending" || task.result !== delivery?.result) return
        if (failure === undefined) task.delivery = { status: "delivered", attempts: task.delivery.attempts, messageID: task.delivery.messageID, attemptedAt: task.delivery.attemptedAt, deliveredAt: deps.now() }
        else task.delivery.lastError = failure
        await deps.save(task)
      })
      return deps.get(taskID)
    } finally {
      deliveriesInFlight.delete(taskID)
    }
  }

  async function deliverQuestion(task: NativeTask): Promise<void> {
    if (task.question === undefined) return
    const questionID = task.question.id
    const key = `${task.id}:${questionID}`
    if (questionsInFlight.has(key)) return
    questionsInFlight.add(key)
    let question: NativeTask["question"]
    try {
      await deps.withTaskLock(task.id, async () => {
        const current = await deps.get(task.id)
        if (current.question?.id !== questionID || current.questionDelivery !== "pending" || current.state !== "waiting_question" || current.answerStatus !== undefined) return
        question = current.question
      })
      if (question === undefined) return
      let failure: string | undefined
      let accepted = false
      try {
        await deps.options.runtime.ask({ parentSessionID: task.parentSessionID, taskID: task.id, question })
        accepted = await deps.wakeParentForQuestion(task.id, questionID)
      } catch (error) { failure = errorText(error) }
      await deps.withTaskLock(task.id, async () => {
        const current = await deps.get(task.id)
        if (current.question?.id !== questionID || current.questionDelivery !== "pending") return
        if (failure === undefined && accepted) current.questionDelivery = "sent"
        else if (failure !== undefined) current.error = `Question delivery failed: ${failure}`
        await deps.save(current)
      })
    } catch (error) {
      await deps.withTaskLock(task.id, async () => {
        const current = await deps.get(task.id)
        if (current.question?.id !== questionID) return
        current.error = `Question delivery failed: ${errorText(error)}`
        await deps.save(current)
      })
    } finally {
      questionsInFlight.delete(key)
    }
  }

  async function resumeExecution(task: NativeTask): Promise<void> {
    if (task.sessionID === undefined) throw new Error("Cannot resume a task without its V2 session")
    if (task.answerStatus === "pending" && task.question !== undefined) {
      await deps.options.runtime.answer({ sessionID: task.sessionID, questionID: task.question.id, answer: task.answer })
      task.answerStatus = "sent"
      await deps.save(task)
      return
    }
    if (task.parentWakeMessage !== undefined) {
      await deps.options.runtime.continueParent({ sessionID: task.sessionID, taskID: task.id, message: task.parentWakeMessage, wakeID: task.parentWakeID })
      task.parentWakeMessage = undefined
      task.parentWakeID = undefined
      task.childrenWakePending = false
      await deps.save(task)
      return
    }
    await deps.options.runtime.resume({ taskID: task.id, sessionID: task.sessionID })
  }

  async function status(taskID: string, callerSessionID: string): Promise<NativeTask> {
    const task = await deps.get(taskID)
    authorizeTask(task, callerSessionID)
    return task
  }

  async function wait(taskID: string, callerSessionID: string, timeoutMs = 30_000): Promise<NativeTask> {
    const end = Date.now() + timeoutMs
    const parentTaskID = await deps.releaseWaitSlot(taskID, callerSessionID)
    const finish = async (task: NativeTask): Promise<NativeTask> => {
      if (parentTaskID === undefined) return task
      await deps.resumeWaitSlot(parentTaskID, taskID)
      while (Date.now() < end || (await deps.get(parentTaskID)).state === "queued") {
        const parent = await deps.get(parentTaskID)
        if (parent.state === "running" || isTerminal(parent.state)) return task
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
      return task
    }
    while (Date.now() < end) {
      const task = await deps.get(taskID)
      authorizeTask(task, callerSessionID)
      if (isTerminal(task.state) || task.state === "awaiting_selection" || task.state === "waiting_question") return finish(task)
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    const task = await deps.get(taskID)
    authorizeTask(task, callerSessionID)
    return finish(task)
  }

  async function retryDeliveries(): Promise<void> {
    for (const task of await deps.options.repository.list()) if (task.delivery?.status === "pending") await deliver(task.id)
  }

  return { select, resume, answer, cancel, deliver, deliverQuestion, resumeExecution, status, wait, retryDeliveries }
}

function authorizeTask(task: NativeTask, callerSessionID: string, allowRoot = true): void {
  if (task.parentSessionID === callerSessionID || (allowRoot && task.rootSessionID === callerSessionID)) return
  throw new Error("Task access is limited to its parent session and root session")
}

