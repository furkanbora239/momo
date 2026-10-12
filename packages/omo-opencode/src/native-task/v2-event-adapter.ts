import type { OpenCodeEvent } from "@opencode/client"
import type { NativeTaskEvent } from "./types"

const toolNames = new Map<string, string>()
const lastProgressAt = new Map<string, number>()

export function mapV2TaskEvent(event: OpenCodeEvent): NativeTaskEvent | undefined {
  switch (event.type) {
    case "session.execution.started":
      return { id: event.id, type: "execution.started", sessionID: event.data.sessionID }
    case "session.execution.succeeded":
      return { id: event.id, type: "execution.succeeded", sessionID: event.data.sessionID }
    case "session.execution.failed":
      return { id: event.id, type: "execution.failed", sessionID: event.data.sessionID, error: errorMessage(event.data.error) }
    case "session.execution.interrupted":
      return { id: event.id, type: "execution.interrupted", sessionID: event.data.sessionID }
    case "session.tool.input.started":
      toolNames.set(`${event.data.sessionID}:${event.data.id}`, event.data.name)
      return { id: event.id, type: "progress", sessionID: event.data.sessionID, message: "Preparing a tool call" }
    case "session.tool.input.delta":
      return shouldReportProgress(event.data.sessionID) ? {
        id: event.id,
        type: "progress",
        sessionID: event.data.sessionID,
        message: "Assistant is producing a tool call",
      } : undefined
    case "session.tool.input.ended":
    case "session.step.streamed":
      return { id: event.id, type: "progress", sessionID: event.data.sessionID, message: "Assistant is producing a response" }
    case "session.text.delta":
    case "session.reasoning.delta":
      return shouldReportProgress(event.data.sessionID) ? {
        id: event.id,
        type: "progress",
        sessionID: event.data.sessionID,
        message: "Assistant is producing a response",
      } : undefined
    case "session.tool.called":
      return { id: event.id, type: "tool.started", sessionID: event.data.sessionID, toolID: event.data.id, toolName: toolNames.get(`${event.data.sessionID}:${event.data.id}`) ?? "tool" }
    case "session.tool.success":
    case "session.tool.failed": {
      toolNames.delete(`${event.data.sessionID}:${event.data.id}`)
      return { id: event.id, type: "tool.finished", sessionID: event.data.sessionID, toolID: event.data.id }
    }
    case "session.tool.progress":
      return { id: event.id, type: "progress", sessionID: event.data.sessionID, message: event.data.id }
    case "form.created":
      return {
        id: event.id,
        type: "question.asked",
        sessionID: event.data.form.sessionID,
        question: {
          id: event.data.form.id,
          prompt: event.data.form.title,
          form: { fields: event.data.form.fields, metadata: event.data.form.metadata },
        },
      }
    case "form.replied":
      return { id: event.id, type: "question.answered", sessionID: event.data.sessionID, questionID: event.data.id, answer: event.data.answer }
    default:
      return undefined
  }
}

function shouldReportProgress(sessionID: string): boolean {
  const timestamp = Date.now()
  const previous = lastProgressAt.get(sessionID) ?? 0
  if (timestamp - previous < 1_500) return false
  lastProgressAt.set(sessionID, timestamp)
  return true
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") return error.message
  return String(error)
}
