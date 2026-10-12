import { isTerminal } from "./lifecycle"
import type { NativeTask, NativeTaskEvent, NativeTaskRepository, NativeTaskRuntime } from "./types"

const EVENT_HISTORY_LIMIT = 128

export async function handleNativeTaskEvent(
  event: NativeTaskEvent,
  deps: {
    repository: NativeTaskRepository
    runtime: NativeTaskRuntime
    save: (task: NativeTask) => Promise<NativeTask>
    now: () => number
    questionTimeoutMs: number
  },
): Promise<void> {
  const task = (await deps.repository.list()).find((candidate) => candidate.sessionID === event.sessionID)
  if (task === undefined || isTerminal(task.state) || task.processedEventIDs.includes(event.id)) return
  task.processedEventIDs.push(event.id)
  if (task.processedEventIDs.length > EVENT_HISTORY_LIMIT) task.processedEventIDs.splice(0, task.processedEventIDs.length - EVENT_HISTORY_LIMIT)
  task.lastActivityAt = deps.now()

  switch (event.type) {
    case "execution.started":
      task.state = "running"
      task.error = undefined
      break
    case "execution.succeeded":
      if (await hasOpenChildren(task, deps.repository)) {
        task.state = "waiting_children"
        task.executionOutcome = { state: "succeeded", result: event.result }
      } else {
        task.state = "succeeded"
        task.result = event.result ?? "Task completed without a text result."
        task.delivery = { status: "pending", attempts: 0 }
      }
      break
    case "execution.failed":
      if (await hasOpenChildren(task, deps.repository)) {
        task.state = "waiting_children"
        task.executionOutcome = { state: "failed", error: event.error }
      } else {
        task.state = "failed"
        task.error = event.error
        task.result = `Task failed: ${event.error}`
        task.delivery = { status: "pending", attempts: 0 }
      }
      break
    case "execution.interrupted":
      task.state = "interrupted"
      break
    case "tool.started":
      if (!task.activeTools.some((tool) => tool.id === event.toolID)) task.activeTools.push({ id: event.toolID, name: event.toolName, startedAt: deps.now() })
      break
    case "tool.finished":
      task.activeTools = task.activeTools.filter((tool) => tool.id !== event.toolID)
      break
    case "progress":
      task.progress = event.message
      break
    case "question.asked":
      task.state = "waiting_question"
      task.question = event.question
      task.questionDelivery = "pending"
      task.questionDeadlineAt = deps.now() + deps.questionTimeoutMs
      task.questionEscalated = false
      task.answer = undefined
      task.answerStatus = undefined
      break
    case "question.answered":
      if (task.question?.id === event.questionID) {
        task.answer = event.answer
        task.answerStatus = "sent"
        task.state = "running"
      }
      break
    case "children.waiting":
      task.state = "waiting_children"
      break
  }
  await deps.save(task)

}

export async function signalTaskChildrenDone(
  parent: NativeTask,
  deps: { repository: NativeTaskRepository; runtime: NativeTaskRuntime; save: (task: NativeTask) => Promise<NativeTask> },
): Promise<void> {
  if (parent.state !== "waiting_children" || parent.childTaskIDs.length === 0) return
  const children = await Promise.all(parent.childTaskIDs.map((id) => deps.repository.get(id)))
  const complete = children.filter((entry): entry is NativeTask => entry !== undefined)
  if (complete.length !== parent.childTaskIDs.length || complete.some((entry) => !isTerminal(entry.state))) return
  const summary = complete.map((entry) => `${entry.id}: ${entry.state}${entry.result ? `: ${entry.result}` : ""}`).join("\n")
  parent.childrenWakePending = true
  parent.parentWakeMessage = summary
  parent.parentWakeID = complete.map((entry) => entry.id).sort().join(":")
  parent.state = "queued"
  await deps.save(parent)
}

async function hasOpenChildren(task: NativeTask, repository: NativeTaskRepository): Promise<boolean> {
  const children = await Promise.all(task.childTaskIDs.map((id) => repository.get(id)))
  return children.some((child) => child === undefined || !isTerminal(child.state))
}

