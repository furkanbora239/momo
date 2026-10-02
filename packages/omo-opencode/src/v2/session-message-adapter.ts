import type { V2PluginContext } from "./types"

type V2SessionMessageInfo = Awaited<ReturnType<V2PluginContext["session"]["context"]>>[number]
type V2AssistantMessage = Extract<V2SessionMessageInfo, { type: "assistant" }>
type V2AssistantContent = V2AssistantMessage["content"][number]
type V2ToolPart = Extract<V2AssistantContent, { type: "tool" }>
type V2ToolState = NonNullable<V2ToolPart["state"]>
type V2ToolCompletedState = Extract<V2ToolState, { status: "completed" }>
type V2ToolContent = V2ToolCompletedState["content"][number]

export type V2SessionMessage = V2SessionMessageInfo

export type V1AdaptedTokenUsage = {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export type V1AdaptedMessageInfo = {
  id: string
  sessionID: string
  role: "user" | "assistant"
  time: { created: number; completed?: number }
  agent?: string
  modelID?: string
  providerID?: string
  cost?: number
  tokens?: V1AdaptedTokenUsage
  error?: unknown
}

export type V1AdaptedToolState =
  | { status: "pending"; input: Record<string, unknown>; raw: string }
  | { status: "running"; input: Record<string, unknown>; metadata: Record<string, unknown> }
  | { status: "completed"; input: Record<string, unknown>; output: string; metadata?: Record<string, unknown> }
  | { status: "error"; input: Record<string, unknown>; error: string; metadata?: Record<string, unknown> }

export type V1AdaptedPart =
  | { type: "text"; text: string; synthetic?: boolean }
  | { type: "reasoning"; text: string }
  | { type: "tool"; callID: string; tool: string; state: V1AdaptedToolState }

export type V1AdaptedMessage = { info: V1AdaptedMessageInfo; parts: V1AdaptedPart[] }

/**
 * Adapts V2 session context records into the V1 `{ info, parts }` message
 * envelope momo's 60+ `client.session.messages` call sites consume.
 *
 * Mapping: user/synthetic/system records become V1 user messages (synthetic
 * flagged on the text part, matching V1's synthetic text parts); assistant
 * records keep agent/model/cost/tokens/error on `info` and map `content`
 * entries to V1 text/reasoning/tool parts. Bookkeeping records (skill, shell,
 * compaction, idle, agent-switched, model-switched, location-switched) have
 * no V1 message equivalent and are dropped.
 */
export function adaptSessionMessages(
  messages: readonly V2SessionMessageInfo[],
  sessionID: string,
): V1AdaptedMessage[] {
  const adapted: V1AdaptedMessage[] = []
  for (const message of messages) {
    const candidate = adaptSessionMessage(message, sessionID)
    if (candidate !== undefined) adapted.push(candidate)
  }
  return adapted
}

function adaptSessionMessage(
  message: V2SessionMessageInfo,
  sessionID: string,
): V1AdaptedMessage | undefined {
  if (message.type === "user" || message.type === "synthetic" || message.type === "system") {
    return {
      info: { id: message.id, sessionID, role: "user", time: { created: message.time.created } },
      parts: [
        {
          type: "text",
          text: message.text,
          ...(message.type === "synthetic" ? { synthetic: true } : {}),
        },
      ],
    }
  }
  if (message.type !== "assistant") {
    return undefined
  }
  return {
    info: {
      id: message.id,
      sessionID,
      role: "assistant",
      time: {
        created: message.time.created,
        ...(message.time.completed !== undefined ? { completed: message.time.completed } : {}),
      },
      ...(message.agent !== undefined ? { agent: message.agent } : {}),
      ...(message.model !== undefined
        ? { modelID: message.model.id, providerID: message.model.providerID }
        : {}),
      ...(message.cost !== undefined ? { cost: message.cost } : {}),
      ...(message.tokens !== undefined ? { tokens: message.tokens } : {}),
      ...(message.error !== undefined ? { error: message.error } : {}),
    },
    parts: message.content.map((part) => adaptAssistantPart(part)),
  }
}

function adaptAssistantPart(part: V2AssistantContent): V1AdaptedPart {
  if (part.type === "text") {
    return { type: "text", text: part.text }
  }
  if (part.type === "reasoning") {
    return { type: "reasoning", text: part.text }
  }
  return { type: "tool", callID: part.id, tool: part.name, state: adaptToolState(part.state) }
}

function adaptToolState(state: V2ToolState): V1AdaptedToolState {
  if (state.status === "streaming") {
    return { status: "pending", input: {}, raw: state.input }
  }
  if (state.status === "running") {
    return { status: "running", input: state.input, metadata: state.metadata }
  }
  if (state.status === "completed") {
    return {
      status: "completed",
      input: state.input,
      output: joinToolContent(state.content),
      ...(state.metadata !== undefined ? { metadata: state.metadata } : {}),
    }
  }
  return {
    status: "error",
    input: state.input,
    error: state.error.message,
    ...(state.metadata !== undefined ? { metadata: state.metadata } : {}),
  }
}

function joinToolContent(content: readonly V2ToolContent[]): string {
  return content
    .map((item) =>
      item.type === "text"
        ? item.text
        : JSON.stringify({ type: "file", uri: item.uri, mime: item.mime, name: item.name ?? null }),
    )
    .join("\n")
}
