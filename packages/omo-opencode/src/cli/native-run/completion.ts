import type { NativeOpenCodeClient } from "./types"
import { areRootTasksDelivered, readRootTasks, type RootTaskSnapshot } from "./tasks"

export type NativeCompletion = { success: boolean; messageCount: number; summary: string; tasks: RootTaskSnapshot[] }

export async function waitForNativeCompletion(input: {
  client: NativeOpenCodeClient
  directory: string
  sessionID: string
  signal: AbortSignal
  json: boolean
  verbose: boolean
  timestamp: boolean
}): Promise<NativeCompletion | 130> {
  const events = input.client.event.subscribe({ signal: input.signal })[Symbol.asyncIterator]()
  let nextEvent = events.next()
  let execution: { success: boolean; error?: string } | undefined
  let messageCount = 0
  let summary = ""
  let tasks: RootTaskSnapshot[] = []
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
        if (event.type === "session.text.delta") {
          summary += event.data.delta
          if (!input.json) {
            atLineStart = writeText(event.data.delta, input.timestamp, atLineStart)
          }
        }
        if (input.verbose && event.type === "session.tool.input.started") {
          process.stderr.write(`\n[tool] ${event.data.name}\n`)
        }
        if (event.type === "session.execution.succeeded") execution = { success: true }
        if (event.type === "session.execution.failed") execution = { success: false, error: JSON.stringify(event.data.error) }
        if (event.type === "session.execution.interrupted") execution = { success: false, error: "Execution interrupted" }
      }
      nextEvent = events.next()
    }
    if (execution !== undefined) {
      tasks = await readRootTasks(input.client, input.directory, input.sessionID)
      if (areRootTasksDelivered(tasks)) {
        await events.return?.()
        if (execution.error !== undefined) process.stderr.write(`\n${execution.error}\n`)
        return { success: execution.success && tasks.every((task) => task.state === "succeeded"), messageCount, summary: summary.trim(), tasks }
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

