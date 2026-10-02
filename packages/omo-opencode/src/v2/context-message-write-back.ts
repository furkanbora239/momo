import type { Part as V1SdkPart } from "@opencode-ai/sdk"
import { isRecord } from "@oh-my-opencode/utils"
import {
  type BuiltContextMessageViews,
  type ContextMessageAdapterLogOnce,
  type TrackedContextMessageView,
  type V2ContextContent,
  type V2ContextMessage,
  type V1ContextMessageView,
} from "./context-message-adapter"

/**
 * Flows the final state of the V1 `{ info, parts }` message views back onto
 * the V2 `session.hook("context", ...)` event (`e.messages`), which the
 * handlers mutated in place.
 *
 * Contract: every view part carries an origin reference to its V2 content
 * entry (WeakMap). Handlers mutate view parts in place (momo's convention,
 * e.g. local-translator.ts); a replaced part object is treated as a new
 * insertion. Text-level edits sync in place onto the origin entry for user
 * and assistant views. Structural changes rebuild the content array of USER
 * views from the final part order (origin entries are reused so
 * unrepresentable media parts survive); structural changes on ASSISTANT views
 * degrade with a log-once because rebuilding assistant content would risk the
 * V2 tool-call/tool-result protocol. Pushed views become fresh V2 messages
 * inserted at the position of the next tracked source; deleted views splice
 * their source out.
 */
export function applyContextMessageWriteBack(
  e: { readonly sessionID: string; messages: V2ContextMessage[] },
  built: BuiltContextMessageViews,
  finalViews: readonly V1ContextMessageView[],
  logOnce: ContextMessageAdapterLogOnce,
): void {
  const present = new Set(finalViews)
  for (const entry of built.tracked) {
    if (!present.has(entry.view)) {
      removeSourceMessage(e.messages, entry.source)
      continue
    }
    if (JSON.stringify(entry.view) === entry.snapshot) continue
    if (entry.source.role === "user") {
      rebuildUserContent(entry.source, entry.view, built.originParts, e.sessionID, logOnce)
      continue
    }
    syncAssistantText(entry, built.originParts, logOnce)
  }

  for (let viewIndex = 0; viewIndex < finalViews.length; viewIndex += 1) {
    const view = finalViews[viewIndex]
    if (view === undefined) continue
    if (built.tracked.some((entry) => entry.view === view)) continue
    const nextSource = findNextSource(finalViews, built, viewIndex)
    if (nextSource === undefined) {
      e.messages.push(toV2Message(view))
      continue
    }
    const position = e.messages.indexOf(nextSource)
    if (position === -1) {
      e.messages.push(toV2Message(view))
      continue
    }
    e.messages.splice(position, 0, toV2Message(view))
  }
}

function removeSourceMessage(messages: V2ContextMessage[], source: V2ContextMessage): void {
  const position = messages.indexOf(source)
  if (position !== -1) messages.splice(position, 1)
}

function findNextSource(
  finalViews: readonly V1ContextMessageView[],
  built: BuiltContextMessageViews,
  fromViewIndex: number,
): V2ContextMessage | undefined {
  for (let index = fromViewIndex + 1; index < finalViews.length; index += 1) {
    const view = finalViews[index]
    const tracked = built.tracked.find((entry) => entry.view === view)
    if (tracked !== undefined) return tracked.source
  }
  return undefined
}

function rebuildUserContent(
  source: V2ContextMessage,
  view: V1ContextMessageView,
  originParts: WeakMap<V1SdkPart, V2ContextContent>,
  sessionID: string,
  logOnce: ContextMessageAdapterLogOnce,
): void {
  const included = new Set<V2ContextContent>()
  const newContent: V2ContextContent[] = []
  for (const part of view.parts) {
    const entry = originParts.get(part)
    if (entry !== undefined) {
      included.add(entry)
      syncOriginText(entry, part)
      newContent.push(entry)
      continue
    }
    const partText = readViewPartText(part)
    if (partText === undefined || part.type !== "text") {
      logOnce(
        "user-view-non-text",
        "non-text parts added by a V1 handler cannot flow back into V2 content; degraded",
        { sessionID },
      )
      continue
    }
    const metadata = viewPartMetadata(part)
    newContent.push({ type: "text", text: partText, ...(metadata !== undefined ? { metadata } : {}) })
  }
  for (const entry of source.content) {
    if (included.has(entry)) continue
    newContent.push(entry)
  }
  ;(source as unknown as { content: V2ContextContent[] }).content = newContent
}

function syncAssistantText(
  entry: TrackedContextMessageView,
  originParts: WeakMap<V1SdkPart, V2ContextContent>,
  logOnce: ContextMessageAdapterLogOnce,
): void {
  if (entry.view.parts.length > entry.partsCount) {
    logOnce(
      "assistant-view-structure",
      "parts added to an assistant view cannot flow back into V2 content; degraded",
      { sessionID: entry.view.info.sessionID },
    )
  }
  for (const part of entry.view.parts) {
    const origin = originParts.get(part)
    if (origin === undefined) continue
    syncOriginText(origin, part)
  }
}

function syncOriginText(origin: V2ContextContent, part: V1SdkPart): void {
  const originText = (origin as { type: string; text?: string }).text
  const partText = readViewPartText(part)
  if (typeof originText === "string" && partText !== undefined && originText !== partText) {
    ;(origin as { text: string }).text = partText
  }
}

function readViewPartText(part: V1SdkPart): string | undefined {
  const record = isRecord(part) ? part : undefined
  if (record === undefined) return undefined
  if (record["type"] !== "text" && record["type"] !== "reasoning") return undefined
  const text = record["text"]
  return typeof text === "string" ? text : undefined
}

function viewPartMetadata(part: V1SdkPart): Record<string, unknown> | undefined {
  const metadata = (part as { metadata?: unknown }).metadata
  return isRecord(metadata) ? metadata : undefined
}

function toV2Message(view: V1ContextMessageView): V2ContextMessage {
  const content = view.parts
    .map((part) => {
      const text = readViewPartText(part)
      const metadata = viewPartMetadata(part)
      if (text === undefined) return undefined
      if (part.type === "reasoning") {
        return { type: "reasoning" as const, text, ...(metadata !== undefined ? { metadata } : {}) }
      }
      if (part.type === "text") {
        return { type: "text" as const, text, ...(metadata !== undefined ? { metadata } : {}) }
      }
      return undefined
    })
    .filter(
      (entry): entry is { type: "text"; text: string } | { type: "reasoning"; text: string } =>
        entry !== undefined,
    )
  return {
    ...(typeof view.info.id === "string" ? { id: view.info.id } : {}),
    role: view.info.role === "assistant" ? ("assistant" as const) : ("user" as const),
    content,
  }
}
