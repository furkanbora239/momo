import type { OpenCode } from "../../packages/omo-opencode/node_modules/@opencode/client/dist/promise/index.js"

type TaskRow = Record<string, unknown>
type Client = ReturnType<typeof OpenCode.make>

export async function proveNativeRestartAndCancel(input: {
  client: Client
  directory: string
  providerID: string
  modelID: string
  tasks: (rootSessionID: string) => Promise<TaskRow[]>
  restart: () => Promise<void>
  modelCallCount: () => Promise<number>
  workerStarted: (marker: string) => Promise<boolean>
}): Promise<Record<string, unknown>> {
  const root = await input.client.session.create({ location: { directory: input.directory }, agent: "momo-orchestrator", model: { providerID: input.providerID, id: input.modelID } })
  async function poll(marker: string, predicate: (task: TaskRow) => boolean): Promise<TaskRow> {
    const deadline = Date.now() + 30_000
    let last: TaskRow | undefined
    while (Date.now() < deadline) {
      const matching = (await input.tasks(root.id)).filter((row) => row.prompt === marker)
      if (matching.length > 1) throw new Error(`Duplicate task for ${marker}`)
      last = matching[0]
      if (last && predicate(last)) return last
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Timed out waiting for ${marker}: ${JSON.stringify(last)}`)
  }
  async function createSlow(marker: string): Promise<TaskRow> {
    await input.client.session.prompt({ sessionID: root.id, text: `MOMO_LIFECYCLE_CREATE ${marker}` })
    await input.client.session.wait({ sessionID: root.id })
    const task = await poll(marker, (row) => row.state === "running" && typeof row.sessionID === "string")
    const deadline = Date.now() + 10_000
    while (!await input.workerStarted(marker)) {
      if (Date.now() >= deadline) throw new Error(`Worker did not reach the fake provider: ${marker}`)
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return task
  }

  const before = await createSlow("MOMO_LIFECYCLE_RESTART_CHILD")
  await input.restart()
  const resumed = await poll("MOMO_LIFECYCLE_RESTART_CHILD", (row) => row.state === "succeeded" && (row.delivery as TaskRow | undefined)?.status === "delivered")
  if (resumed.id !== before.id || resumed.sessionID !== before.sessionID || resumed.decisionId !== before.decisionId || Number(resumed.attempts) < 2) throw new Error("Restart changed task/session/decision identity or did not resume the interrupted attempt")
  const callsBeforeSecondRestart = await input.modelCallCount()
  await input.restart()
  await new Promise((resolve) => setTimeout(resolve, 750))
  const completed = await poll("MOMO_LIFECYCLE_RESTART_CHILD", (row) => row.state === "succeeded")
  if (completed.attempts !== resumed.attempts || completed.sessionID !== resumed.sessionID || await input.modelCallCount() !== callsBeforeSecondRestart) throw new Error(`A completed task reran after the second server restart: attempts ${resumed.attempts}/${completed.attempts}, worker calls ${callsBeforeSecondRestart}/${await input.modelCallCount()}`)

  const cancellation = await createSlow("MOMO_LIFECYCLE_CANCEL_CHILD")
  await input.client.session.prompt({ sessionID: root.id, text: `MOMO_LIFECYCLE_CANCEL ${cancellation.id}` })
  await input.client.session.wait({ sessionID: root.id })
  const cancelled = await poll("MOMO_LIFECYCLE_CANCEL_CHILD", (row) => row.state === "cancelled" && (row.delivery as TaskRow | undefined)?.status === "delivered")
  const active = await input.client.session.active()
  if (active[String(cancelled.sessionID)] !== undefined) throw new Error("Cancelled child remains active in the native service")
  await input.restart()
  const afterCancelRestart = await poll("MOMO_LIFECYCLE_CANCEL_CHILD", (row) => row.state === "cancelled")
  if (afterCancelRestart.attempts !== cancelled.attempts || afterCancelRestart.sessionID !== cancelled.sessionID) throw new Error("Cancelled child resumed on restart")
  async function createDepartment(marker: string, childMarker: string): Promise<{ department: TaskRow; child: TaskRow }> {
    await input.client.session.prompt({ sessionID: root.id, text: `MOMO_LIFECYCLE_CREATE ${marker}` })
    await input.client.session.wait({ sessionID: root.id })
    const department = await poll(marker, (row) => row.role === "planner" && row.state === "waiting_children")
    const child = await poll(childMarker, (row) => row.parentTaskID === department.id && row.state === "running")
    const deadline = Date.now() + 10_000
    while (!await input.workerStarted(childMarker)) {
      if (Date.now() >= deadline) throw new Error("Department child never reached the fake model")
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    return { department, child }
  }
  const departmentBefore = await createDepartment("MOMO_LIFECYCLE_RESTART_DEPARTMENT", "MOMO_LIFECYCLE_DEPARTMENT_RESTART_CHILD")
  await input.restart()
  const departmentAfter = await poll("MOMO_LIFECYCLE_RESTART_DEPARTMENT", (row) => row.state === "succeeded" && (row.delivery as TaskRow | undefined)?.status === "delivered")
  const childAfter = await poll("MOMO_LIFECYCLE_DEPARTMENT_RESTART_CHILD", (row) => row.state === "succeeded")
  for (const [previous, current] of [[departmentBefore.department, departmentAfter], [departmentBefore.child, childAfter]]) {
    if (previous!.id !== current!.id || previous!.sessionID !== current!.sessionID || previous!.decisionId !== current!.decisionId) throw new Error("Department restart changed lineage or assignment")
  }
  const cancellationTree = await createDepartment("MOMO_LIFECYCLE_CANCEL_DEPARTMENT", "MOMO_LIFECYCLE_DEPARTMENT_CANCEL_CHILD")
  await input.client.session.prompt({ sessionID: root.id, text: `MOMO_LIFECYCLE_CANCEL ${cancellationTree.department.id}` })
  await input.client.session.wait({ sessionID: root.id })
  const cancelledDepartment = await poll("MOMO_LIFECYCLE_CANCEL_DEPARTMENT", (row) => row.state === "cancelled")
  const cancelledDescendant = await poll("MOMO_LIFECYCLE_DEPARTMENT_CANCEL_CHILD", (row) => row.state === "cancelled")
  const remaining = await input.client.session.active()
  if (remaining[String(cancelledDepartment.sessionID)] || remaining[String(cancelledDescendant.sessionID)]) throw new Error("Cancelled department has an active native descendant")
  await input.restart()
  const retainedDepartment = await poll("MOMO_LIFECYCLE_CANCEL_DEPARTMENT", (row) => row.state === "cancelled")
  const retainedDescendant = await poll("MOMO_LIFECYCLE_DEPARTMENT_CANCEL_CHILD", (row) => row.state === "cancelled")
  if (retainedDepartment.attempts !== cancelledDepartment.attempts || retainedDescendant.attempts !== cancelledDescendant.attempts) throw new Error("Cancelled department tree resumed after restart")
  return {
    status: "passed", realServerRestarts: 5,
    resumed: { taskID: resumed.id, sessionID: resumed.sessionID, decisionID: resumed.decisionId, attempts: resumed.attempts, state: resumed.state, delivery: resumed.delivery },
    completedTaskDidNotRerun: true,
    cancelled: { taskID: cancelled.id, sessionID: cancelled.sessionID, attempts: cancelled.attempts, state: cancelled.state, delivery: cancelled.delivery },
    cancelledSessionInactive: true, cancelledTaskDidNotResume: true,
    departmentRestart: { sameTaskAndSessionIDs: true, childParentTaskID: childAfter.parentTaskID, departmentTaskID: departmentAfter.id, state: departmentAfter.state },
    cancelledDepartmentTree: { parentState: cancelledDepartment.state, descendantState: cancelledDescendant.state, inactive: true, retainedAcrossRestart: true },
  }
}
