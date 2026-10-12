import { createNativeTaskID } from "./id"
import { applyRoute, assertCanCreate, hasCapacity, sameModel } from "./guards"
import type {
  NativeTask,
  NativeTaskEngineOptions,
  NativeTaskKind,
} from "./types"
import { signalTaskChildrenDone } from "./events"
import { errorText, isTerminal } from "./lifecycle"
import { runNativeTask } from "./runner"
import { createNativeTaskControls } from "./task-controls"
import { createNativeTaskLifecycle } from "./task-lifecycle"

export type NativeTaskCreateInput = {
  prompt: string
  scope?: string
  acceptance?: string
  callerSessionID: string
  kind?: NativeTaskKind
}

export type NativeTaskResearchInput = {
  prompt: string
  scope?: string
  acceptance?: string
  callerSessionID: string
  sourceDecisionID: string
}

export type NativeTaskEngine = ReturnType<typeof createNativeTaskEngine>

export function createNativeTaskEngine(options: NativeTaskEngineOptions) {
  const now = options.now ?? Date.now
  const maxConcurrent = options.maxConcurrent === undefined ? Number.POSITIVE_INFINITY : (options.maxConcurrent === 0 ? Number.POSITIVE_INFINITY : Math.max(1, options.maxConcurrent))
  const taskLocks = new Map<string, Promise<void>>()
  let pumping: Promise<void> | undefined

  async function save(task: NativeTask): Promise<NativeTask> {
    task.updatedAt = now()
    await options.repository.save(task)
    return task
  }

  async function get(taskID: string): Promise<NativeTask> {
    const task = await options.repository.get(taskID)
    if (task === undefined) throw new Error(`Unknown native task: ${taskID}`)
    return task
  }

  async function create(input: NativeTaskCreateInput): Promise<NativeTask> {
    return createTask(input)
  }

  async function createResearch(input: NativeTaskResearchInput): Promise<NativeTask> {
    const caller = await options.runtime.resolveCaller(input.callerSessionID)
    if (caller.role !== "orchestrator" || caller.rootSessionID !== input.callerSessionID) {
      throw new Error("Catalog research can only be created by the root orchestrator session")
    }
    return createTask({ ...input, kind: "task" }, "catalog-researcher", input.sourceDecisionID)
  }

  async function createTask(input: NativeTaskCreateInput, requiredRole?: NativeTask["requiredRole"], sourceDecisionID?: string): Promise<NativeTask> {
    const kind = input.kind ?? "task"
    const caller = await options.runtime.resolveCaller(input.callerSessionID)
    const parent = (await options.repository.list()).find((task) => task.sessionID === input.callerSessionID && (task.state === "running" || task.state === "waiting_children" || task.state === "waiting_question"))
    const parentRole = caller.role
    if (parent !== undefined && (parent.role !== caller.role || parent.rootSessionID !== caller.rootSessionID)) {
      throw new Error("OpenCode session role or lineage does not match persisted task state")
    }
    assertCanCreate(parentRole, kind)
    if (parent !== undefined && (parent.state === "waiting_question" || parent.state === "waiting_children")) {
      throw new Error("A task can only spawn while its session is actively running")
    }
    const id = createNativeTaskID()
    const timestamp = now()
    const task: NativeTask = {
      id,
      rootTaskID: parent?.rootTaskID ?? id,
      ...(parent !== undefined ? { parentTaskID: parent.id } : {}),
      rootSessionID: caller.rootSessionID,
      parentSessionID: input.callerSessionID,
      kind,
      parentRole,
      ...(requiredRole !== undefined ? { requiredRole } : {}),
      ...(sourceDecisionID !== undefined ? { sourceDecisionID } : {}),
      decisionId: id,
      state: "queued",
      prompt: input.prompt,
      ...(input.scope !== undefined ? { scope: input.scope } : {}),
      ...(input.acceptance !== undefined ? { acceptance: input.acceptance } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
      attempts: 0,
      routeStatus: "pending",
      activeTools: [],
      childTaskIDs: [],
      processedEventIDs: [],
      lastActivityAt: timestamp,
    }
    await withTaskLock(id, async () => {
      await save(task)
      const routed = await options.router.route({
        decisionId: id,
        prompt: input.prompt,
        ...(input.scope !== undefined ? { scope: input.scope } : {}),
        ...(input.acceptance !== undefined ? { acceptance: input.acceptance } : {}),
        parentRole,
        ...(requiredRole !== undefined ? { requiredRole } : {}),
        rootSessionID: task.rootSessionID,
        parentSessionID: task.parentSessionID,
        kind,
      })
      applyRoute(task, routed)
      await save(task)
    })
    await linkToParent(task)
    if (task.state === "queued") await pump()
    if (task.delivery?.status === "pending") await controls.deliver(task.id)
    return get(task.id)
  }

  async function linkToParent(task: NativeTask): Promise<void> {
    if (task.parentTaskID === undefined) return
    await withTaskLock(task.parentTaskID, async () => {
      const parent = await get(task.parentTaskID ?? "")
      if (!parent.childTaskIDs.includes(task.id)) parent.childTaskIDs.push(task.id)
      await save(parent)
    })
  }

  async function pump(): Promise<void> {
    if (pumping !== undefined) return pumping
    pumping = pumpQueue().finally(() => { pumping = undefined })
    return pumping
  }

  async function pumpQueue(): Promise<void> {
    while (true) {
      const tasks = await options.repository.list()
      const active = tasks.filter((task) => task.state === "running").length
      if (active >= maxConcurrent) return
      const next = tasks.find((task) => task.state === "queued" && hasCapacity(task, tasks, maxConcurrent, options.providerConcurrency, options.modelConcurrency, options.defaultConcurrency ?? 5))
      if (next === undefined) return
      if (options.router.revalidateSelected !== undefined && !(await revalidateQueued(next.id))) continue
      await withTaskLock(next.id, async () => {
        const current = await get(next.id)
        if (current.state !== "queued") return
        await runNativeTask(current, {
          repository: options.repository,
          runtime: options.runtime,
          save,
          now,
          onAllocated: recordDispatch,
          onResume: controls.resumeExecution,
        })
        const finished = await get(current.id)
        if (finished.state === "failed") await recordOutcome(finished)
      })
    }
  }

  async function revalidateQueued(taskID: string): Promise<boolean> {
    let valid = false
    await withTaskLock(taskID, async () => {
      const task = await get(taskID)
      if (task.state !== "queued" || task.decisionId === undefined) return
      const result = await options.router.revalidateSelected?.(task.decisionId, task.parentSessionID)
      if (result === undefined) { valid = true; return }
      if (result.kind === "selected" && result.role === task.role && sameModel(result.model, task.model)) {
        if (task.sessionID === undefined) task.decisionId = result.decisionId
        await save(task)
        valid = true
      } else {
        if (task.sessionID !== undefined) {
          task.state = "interrupted"
          task.error = "The original model assignment is no longer available for this existing session. Resume requires the original assignment."
          await save(task)
          return
        }
        applyRoute(task, result)
        await save(task)
      }
    })
    const latest = await get(taskID)
    if (latest.state === "failed" && latest.delivery?.status === "pending") await controls.deliver(taskID)
    return valid
  }

  async function retryChildWake(task: NativeTask): Promise<void> {
    let shouldResume = false
    await withTaskLock(task.id, async () => {
      const current = await get(task.id)
      if (current.waitForTaskID !== undefined) return
      if (current.executionOutcome !== undefined && await allChildrenTerminal(current)) current.executionOutcome = undefined
      await signalTaskChildrenDone(current, { repository: options.repository, runtime: options.runtime, save })
      if (current.state === "queued" && current.parentWakeMessage !== undefined) shouldResume = true
    })
    if (shouldResume) await pump()
  }

  async function releaseWaitSlot(taskID: string, callerSessionID: string): Promise<string | undefined> {
    const parent = (await options.repository.list()).find((task) => task.sessionID === callerSessionID && task.childTaskIDs.includes(taskID) && task.state === "running")
    if (parent === undefined) return undefined
    let released = false
    await withTaskLock(parent.id, async () => {
      const current = await get(parent.id)
      if (current.state !== "running" || !current.childTaskIDs.includes(taskID)) return
      current.waitForTaskID = taskID
      current.state = "waiting_children"
      await save(current)
      released = true
    })
    if (!released) return undefined
    await pump()
    return parent.id
  }

  async function resumeWaitSlot(parentTaskID: string, taskID: string): Promise<void> {
    let queued = false
    await withTaskLock(parentTaskID, async () => {
      const parent = await get(parentTaskID)
      if (parent.waitForTaskID !== taskID || isTerminal(parent.state)) return
      parent.waitForTaskID = undefined
      parent.state = "queued"
      parent.resumeInPlace = true
      await save(parent)
      queued = true
    })
    if (queued) await pump()
  }

  async function finishFromInspection(task: NativeTask, result: { state: "succeeded" | "failed"; result?: string; error?: string }): Promise<void> {
    if (await hasOpenChildren(task)) {
      task.state = "waiting_children"
      task.executionOutcome = result
      await save(task)
      return
    }
    task.state = result.state
    task.result = result.result ?? (result.error ? `Task failed: ${result.error}` : "Task completed without a text result.")
    if (result.error !== undefined) task.error = result.error
    task.delivery = { status: "pending", attempts: 0 }
    await save(task)
    await recordOutcome(task)
  }

  async function failMissingSession(task: NativeTask): Promise<void> {
    task.state = "failed"
    task.error = "The persisted OpenCode child session no longer exists."
    task.result = task.error
    task.delivery = { status: "pending", attempts: 0 }
    await save(task)
    await recordOutcome(task)
  }

  async function hasOpenChildren(task: NativeTask): Promise<boolean> {
    return !(await allChildrenTerminal(task))
  }

  async function allChildrenTerminal(task: NativeTask): Promise<boolean> {
    if (task.childTaskIDs.length === 0) return true
    const children = await Promise.all(task.childTaskIDs.map((id) => options.repository.get(id)))
    return children.every((child) => child !== undefined && isTerminal(child.state))
  }

  async function recordDispatch(task: NativeTask): Promise<void> {
    if (task.dispatchStatus === "recorded" || task.decisionId === undefined || task.sessionID === undefined || task.role === undefined || task.model === undefined) return
    task.dispatchStatus = "pending"
    await save(task)
    try {
      await options.router.recordDispatch?.(task.decisionId, { taskId: task.id, sessionId: task.sessionID, role: task.role, model: task.model }, task.parentSessionID)
      task.dispatchStatus = "recorded"
      await save(task)
    } catch (error) {
      task.dispatchError = errorText(error)
      await save(task)
    }
  }

  async function recordOutcome(task: NativeTask): Promise<void> {
    if (task.state === "cancelled" || task.outcomeStatus === "recorded" || task.decisionId === undefined || task.role === undefined || task.model === undefined || !isTerminal(task.state)) return
    if (task.sessionID !== undefined) {
      try {
        const inspection = await options.runtime.inspect(task.sessionID)
        if (inspection.usage !== undefined) task.usage = inspection.usage
      } catch (error) {
        task.usageError = errorText(error)
      }
      if (task.usage !== undefined || task.usageError !== undefined) {
        await save(task)
      }
    }
    task.outcomeStatus = "pending"
    await save(task)
    try {
      await options.router.recordOutcome?.(task.decisionId, {
        model: task.model,
        role: task.role,
        taskKind: task.kind,
        result: task.state === "succeeded" ? "success" : task.state === "failed" ? "failure" : task.state === "interrupted" ? "timeout" : "unknown",
        provenance: "runtime",
        taskId: task.id,
        ...(task.sessionID !== undefined ? { sessionId: task.sessionID } : {}),
        verification: "unknown",
        ...(task.usage !== undefined ? { inputTokens: task.usage.inputTokens, outputTokens: task.usage.outputTokens } : {}),
        ...(task.startedAt !== undefined ? { durationMs: Math.max(0, now() - task.startedAt) } : {}),
      }, task.parentSessionID)
      task.outcomeStatus = "recorded"
      await save(task)
    } catch (error) {
      task.outcomeError = errorText(error)
      await save(task)
    }
  }

  async function retryRouterRecords(task: NativeTask): Promise<void> {
    if (task.sessionID !== undefined && task.role !== undefined && task.model !== undefined && task.dispatchStatus !== "recorded") await recordDispatch(task)
    if (isTerminal(task.state) && task.outcomeStatus !== "recorded") await recordOutcome(task)
  }

  async function withTaskLock<T>(taskID: string, action: () => Promise<T>): Promise<T> {
    const previous = taskLocks.get(taskID) ?? Promise.resolve()
    let release = () => {}
    const next = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => next)
    taskLocks.set(taskID, queued)
    await previous
    try { return await action() } finally {
      release()
      if (taskLocks.get(taskID) === queued) taskLocks.delete(taskID)
    }
  }

  const controls = createNativeTaskControls({
    options,
    now,
    get,
    save,
    withTaskLock,
    pump,
    releaseWaitSlot,
    resumeWaitSlot,
    recordOutcome,
    retryChildWake,
    finishFromInspection,
    failMissingSession,
  })
  const lifecycle = createNativeTaskLifecycle({
    options,
    now,
    get,
    save,
    withTaskLock,
    pump,
    controls,
    retryChildWake,
    recordOutcome,
    retryRouterRecords,
    finishFromInspection,
    failMissingSession,
    linkToParent,
  })
  return { create, createResearch, ...controls, ...lifecycle }
}

