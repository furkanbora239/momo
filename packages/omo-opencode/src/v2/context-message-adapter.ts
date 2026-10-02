import type {
  Message as V1SdkMessage,
  Part as V1SdkPart,
  ToolState as V1SdkToolState,
} from "@opencode-ai/sdk"
import { isRecord } from "@oh-my-opencode/utils"
import type { SessionContext } from "@opencode/plugin/promise/session"

/**
 * Adapts the V2 `session.hook("context", ...)` messages into the V1 SDK
 * `{ info, parts }` views the assembled momo messages-transform handlers
 * consume; the mutation flow-back lives in context-message-write-back.ts.
 * Mapping mirrors session-message-adapter.ts conventions: V2 text content
 * becomes V1 text parts, `reasoning` becomes reasoning parts, and `tool-call`
 * becomes a tool part whose state is `pending`, or `completed` when a matching
 * `tool-result` part arrives in a later `tool`-role message (mirroring the V1
 * single-tool-part shape that tool-pair-validator consumes). V2 `media`,
 * `compaction`, and `effort` content and `system`/`tool`-role messages stay
 * untracked and are preserved in place by the write-back.
 */
export type V1ContextMessageView = { info: V1SdkMessage; parts: V1SdkPart[] }

export type TrackedContextMessageView = {
  view: V1ContextMessageView
  snapshot: string
  partsCount: number
  source: V2ContextMessage
}

type V2ContextMessage = SessionContext["messages"][number]
type V2ContextContent = V2ContextMessage["content"][number]
type V2ContextTextContent = Extract<V2ContextContent, { type: "text" }>

export type { V2ContextMessage, V2ContextContent }

export type ContextMessageAdapterLogOnce = (
  key: string,
  message: string,
  context?: Record<string, unknown>,
) => void

export type BuiltContextMessageViews = {
  /** The mutable array handed to the V1 handler as `output.messages`. */
  views: V1ContextMessageView[]
  tracked: TrackedContextMessageView[]
  originParts: WeakMap<V1SdkPart, V2ContextContent>
}

export function buildContextMessageViews(
  sessionID: string,
  messages: readonly V2ContextMessage[],
  logOnce: ContextMessageAdapterLogOnce,
): BuiltContextMessageViews {
  const resultTextById = collectToolResultText(messages, logOnce)
  const originParts = new WeakMap<V1SdkPart, V2ContextContent>()
  const tracked: TrackedContextMessageView[] = []
  for (let index = 0; index < messages.length; index += 1) {
    const source = messages[index]
    if (source === undefined) continue
    const view = buildContextMessageView(source, sessionID, index, resultTextById, originParts, logOnce)
    if (view === undefined) continue
    tracked.push({ view, snapshot: JSON.stringify(view), partsCount: view.parts.length, source })
  }
  return { views: tracked.map((entry) => entry.view), tracked, originParts }
}

function buildContextMessageView(
  source: V2ContextMessage,
  sessionID: string,
  index: number,
  resultTextById: Map<string, string>,
  originParts: WeakMap<V1SdkPart, V2ContextContent>,
  logOnce: ContextMessageAdapterLogOnce,
): V1ContextMessageView | undefined {
  if (source.role === "user") return buildUserView(source, sessionID, index, originParts)
  if (source.role === "assistant") {
    return buildAssistantView(source, sessionID, index, resultTextById, originParts)
  }
  logOnce(
    `unmapped-role:${source.role}`,
    `V2 message role "${source.role}" has no V1 message equivalent; preserved in place`,
    { sessionID },
  )
  return undefined
}

function buildUserView(
  source: V2ContextMessage,
  sessionID: string,
  index: number,
  originParts: WeakMap<V1SdkPart, V2ContextContent>,
): V1ContextMessageView {
  const messageID = messageViewId(source, index)
  const info: V1SdkMessage = {
    id: messageID,
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "default",
    model: { providerID: "", modelID: "" },
  }
  const parts: V1SdkPart[] = []
  source.content.forEach((entry, partIndex) => {
    if (entry.type !== "text") return
    parts.push(buildTextPart(entry, messageID, sessionID, partIndex, originParts))
  })
  return { info, parts }
}

function buildAssistantView(
  source: V2ContextMessage,
  sessionID: string,
  index: number,
  resultTextById: Map<string, string>,
  originParts: WeakMap<V1SdkPart, V2ContextContent>,
): V1ContextMessageView {
  const messageID = messageViewId(source, index)
  const info: V1SdkMessage = {
    id: messageID,
    sessionID,
    role: "assistant",
    time: { created: 0 },
    parentID: "",
    modelID: "",
    providerID: "",
    mode: "",
    path: { cwd: "", root: "" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  const parts: V1SdkPart[] = []
  source.content.forEach((entry, partIndex) => {
    const part = buildAssistantContentPart(entry, messageID, sessionID, partIndex, resultTextById, originParts)
    if (part === undefined) return
    parts.push(part)
  })
  return { info, parts }
}

function buildAssistantContentPart(
  entry: V2ContextContent,
  messageID: string,
  sessionID: string,
  partIndex: number,
  resultTextById: Map<string, string>,
  originParts: WeakMap<V1SdkPart, V2ContextContent>,
): V1SdkPart | undefined {
  const withOrigin = (part: V1SdkPart): V1SdkPart => {
    originParts.set(part, entry)
    return part
  }
  if (entry.type === "text") return buildTextPart(entry, messageID, sessionID, partIndex, originParts)
  if (entry.type === "reasoning") {
    return withOrigin({
      id: partId(messageID, partIndex),
      sessionID,
      messageID,
      type: "reasoning",
      text: entry.text,
      time: { start: 0 },
    })
  }
  if (entry.type === "tool-call") {
    const input = isRecord(entry.input) ? entry.input : {}
    const resultText = resultTextById.get(entry.id)
    const state: V1SdkToolState =
      resultText === undefined
        ? { status: "pending", input, raw: JSON.stringify(entry.input ?? {}) }
        : { status: "completed", input, output: resultText, title: "", metadata: {}, time: { start: 0, end: 0 } }
    return withOrigin({
      id: partId(messageID, partIndex),
      sessionID,
      messageID,
      type: "tool",
      callID: entry.id,
      tool: entry.name,
      state,
    })
  }
  return undefined
}

function buildTextPart(
  entry: V2ContextTextContent,
  messageID: string,
  sessionID: string,
  partIndex: number,
  originParts: WeakMap<V1SdkPart, V2ContextContent>,
): V1SdkPart {
  const part: V1SdkPart = {
    id: partId(messageID, partIndex),
    sessionID,
    messageID,
    type: "text",
    text: entry.text,
    ...(isRecord(entry.metadata) ? { metadata: entry.metadata } : {}),
  }
  originParts.set(part, entry)
  return part
}

function collectToolResultText(
  messages: readonly V2ContextMessage[],
  logOnce: ContextMessageAdapterLogOnce,
): Map<string, string> {
  const results = new Map<string, string>()
  for (const message of messages) {
    if (message.role !== "tool") continue
    for (const entry of message.content) {
      if (entry.type !== "tool-result") continue
      const text = joinToolResultValue(entry.result)
      if (text === undefined) {
        logOnce("tool-result-shape", "non-text tool-result values adapt lossily to a text view", {})
        continue
      }
      results.set(entry.id, text)
    }
  }
  return results
}

function joinToolResultValue(result: unknown): string | undefined {
  if (!isRecord(result)) return undefined
  if (result["type"] === "content" && Array.isArray(result["value"])) {
    return (result["value"] as unknown[])
      .map((item) =>
        isRecord(item) && item["type"] === "text" && typeof item["text"] === "string" ? item["text"] : "",
      )
      .join("\n")
  }
  if (result["type"] === "text" || result["type"] === "json" || result["type"] === "error") {
    const value = result["value"]
    return typeof value === "string" ? value : JSON.stringify(value ?? null)
  }
  return undefined
}

function messageViewId(source: V2ContextMessage, index: number): string {
  return typeof source.id === "string" ? source.id : `msg_v2_${index}`
}

function partId(messageID: string, partIndex: number): string {
  return `${messageID}_p${partIndex}`
}
