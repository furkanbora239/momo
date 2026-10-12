import type { NativeOpenCodeClient } from "./types"
import { areRootTasksDelivered, readRootTasks, userJobTasks, type RootTaskSnapshot } from "./tasks"
import { deliveryMessageID } from "../../native-runtime/delivery-message-id"

export type NativeCompletion = { success: boolean; messageCount: number; summary: string; tasks: RootTaskSnapshot[] }

export async function waitForNativeCompletion(input: {
  client: NativeOpenCodeClient
  directory: string
  sessionID: string
  signal: AbortSignal
  json: boolean
  verbose: boolean
  timestamp: boolean
  initialTasks?: RootTaskSnapshot[]
}): Promise<NativeCompletion | 130> {
  const events = input.client.event.subscribe({ signal: input.signal })[Symbol.asyncIterator]()
  let nextEvent = events.next()
  let execution: { success: boolean; error?: string } | undefined
  let messageCount = 0
  let summary = ""
  let tasks: RootTaskSnapshot[] = []
  const seenDeliveredTaskIDs = new Set(userJobTasks(input.initialTasks ?? []).filter((task) => task.delivery === "delivered").map((task) => task.id))
  const newlyDeliveredTaskIDs = new Set<string>()
  let atLineStart = true

  while (!input.signal.aborted) {
    const eventResult = await Promise.race([
      nextEvent.then((result) => ({ kind: "event" as const, result })),
      delay(300).then(() => ({ kind: "tick" as const })),
    ])
    if (eventResult.kind === "event") {
      if (eventResult.result.done) throw new Error("OpenCode v2 event stream closed before execution completion")
      const event = eventResult.result.value
      const eventData: unknown = "data" in event ? event.data : undefined
      if (isRecord(eventData) && eventData.sessionID === input.sessionID) {
        if (event.type === "session.step.started") messageCount++
        if (event.type === "session.execution.started") {
          execution = undefined
        }
        if (event.type === "session.text.delta") {
          summary += event.data.delta
          if (!input.json) {
            atLineStart = writeText(event.data.delta, input.timestamp, atLineStart)
          }
        }
        if (input.verbose && event.type === "session.tool.input.started") {
          process.stderr.write(`\n[tool] ${event.data.name}\n`)
        }
        if (event.type === "session.execution.succeeded") {
          execution = { success: true }
        }
        if (event.type === "session.execution.failed") {
          execution = { success: false, error: JSON.stringify(event.data.error) }
        }
        if (event.type === "session.execution.interrupted") {
          execution = { success: false, error: "Execution interrupted" }
        }
      }
      nextEvent = events.next()
    }
    if (execution !== undefined) {
      tasks = await readRootTasks(input.client, input.directory, input.sessionID)
      let latestNewDeliveryAt: number | undefined
      for (const task of userJobTasks(tasks)) {
        if (task.delivery === "delivered" && !seenDeliveredTaskIDs.has(task.id)) {
          seenDeliveredTaskIDs.add(task.id)
          newlyDeliveredTaskIDs.add(task.id)
        }
      }
      const newlyDeliveredRootChildren = userJobTasks(tasks).filter((task) => task.parentSessionID === input.sessionID && newlyDeliveredTaskIDs.has(task.id))
      if (newlyDeliveredRootChildren.length > 0 && !await rootConsumedDeliveries(input.client, input.sessionID, newlyDeliveredRootChildren)) execution = undefined
    }
    if (execution !== undefined) {
      if (areRootTasksDelivered(tasks)) {
        await events.return?.()
        if (execution.error !== undefined) process.stderr.write(`\n${execution.error}\n`)
        return { success: execution.success && userJobTasks(tasks).every((task) => task.state === "succeeded"), messageCount, summary: summary.trim(), tasks }
      }
    }
  }
  await events.return?.()
  return 130
}

function writeText(value: string, timestamp: boolean, atLineStart: boolean): boolean {
  const lines = value.split(/(?<=\n)/)
  for (const line of lines) {
    if (line.length === 0) continue
    const prefix = timestamp && atLineStart ? `[${new Date().toLocaleTimeString()}] ` : ""
    process.stdout.write(`${prefix}${line}`)
    atLineStart = line.endsWith("\n")
  }
  return atLineStart
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function rootConsumedDeliveries(client: NativeOpenCodeClient, sessionID: string, deliveries: readonly RootTaskSnapshot[]): Promise<boolean> {
  const messageIDs = deliveries.map((task) => task.deliveryMessageID ?? deliveryMessageID(task.id))
  const [context, active, inbox] = await Promise.all([
    client.session.context({ sessionID }),
    client.session.active(),
    client.session.inbox.list({ sessionID }),
  ])
  if (active[sessionID] !== undefined) return false
  const taskIDs = new Set(deliveries.map((task) => task.id))
  const pendingDelivery = inbox.some((item) => item.type === "synthetic" && isRecord(item.payload.metadata) && typeof item.payload.metadata.momoNativeDelivery === "object" && item.payload.metadata.momoNativeDelivery !== null && "taskID" in item.payload.metadata.momoNativeDelivery && taskIDs.has(String(item.payload.metadata.momoNativeDelivery.taskID)))
  if (pendingDelivery) return false
  const deliveryPositions = messageIDs.map((id) => context.findIndex((message) => message.id === id && message.type === "synthetic"))
  if (deliveryPositions.some((position) => position < 0)) return false
  const latestDeliveryPosition = Math.max(...deliveryPositions)
  const hasCompletedAssistantAfterDelivery = context.slice(latestDeliveryPosition + 1).some((message) => message.type === "assistant" && message.time.completed !== undefined)
  return hasCompletedAssistantAfterDelivery && active[sessionID] === undefined
}

