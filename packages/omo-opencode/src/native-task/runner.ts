import { errorText } from "./lifecycle"
import type { NativeTask, NativeTaskRepository, NativeTaskRuntime } from "./types"

export async function runNativeTask(
  task: NativeTask,
  deps: {
    repository: NativeTaskRepository
    runtime: NativeTaskRuntime
    save: (task: NativeTask) => Promise<NativeTask>
    now: () => number
    onAllocated: (task: NativeTask) => Promise<void>
    onResume: (task: NativeTask) => Promise<void>
  },
): Promise<void> {
  if (task.resumeInPlace === true) {
    task.resumeInPlace = undefined
    task.state = "running"
    task.lastActivityAt = deps.now()
    await deps.save(task)
    return
  }
  if (task.role === undefined || task.model === undefined) {
    task.state = "failed"
    task.error = "Queued task has no selected role or model."
    task.result = task.error
    task.delivery = { status: "pending", attempts: 0 }
    await deps.save(task)
    return
  }
  task.state = "running"
  task.attempts += 1
  task.lastActivityAt = deps.now()
  task.startedAt ??= deps.now()
  await deps.save(task)
  try {
    if (task.sessionID === undefined) {
      const session = await deps.runtime.createSession({
        taskID: task.id,
        rootSessionID: task.rootSessionID,
        parentSessionID: task.parentSessionID,
        role: task.role,
        model: task.model,
      })
      task.sessionID = session.sessionID
      await deps.save(task)
      await deps.onAllocated(task)
      await deps.runtime.start({ sessionID: task.sessionID, prompt: buildTaskPrompt(task) })
      return
    }
    await deps.onResume(task)
  } catch (error) {
    task.error = errorText(error)
    if (task.answerStatus === "pending") task.state = "waiting_question"
    else if (task.parentWakeMessage !== undefined) task.state = "waiting_children"
    else {
      task.state = "failed"
      task.result = task.error
      task.delivery = { status: "pending", attempts: 0 }
    }
    await deps.save(task)
  }
}

function buildTaskPrompt(task: NativeTask): string {
  const sections = [task.prompt]
  if (task.scope !== undefined) sections.push(`Scope:\n${task.scope}`)
  if (task.acceptance !== undefined) sections.push(`Acceptance criteria:\n${task.acceptance}`)
  if (task.kind === "consultation") sections.push("Provide concise advice. Do not execute the requested work.")
  if (task.role === "advisor") sections.push("Use read-only research tools only. Do not spawn tasks or modify files.")
  return sections.join("\n\n")
}
