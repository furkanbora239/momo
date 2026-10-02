import type { Event as V1Event, Permission as V1SdkPermission, Session as V1SdkSession } from "@opencode-ai/sdk"
import type { OpenCodeEvent as V2Event } from "@opencode/client"
import { isRecord } from "@oh-my-opencode/utils"
import { log } from "../shared/logger"
import type { HooksWithRuntimeLifecycle } from "../testing/create-plugin-module"
import type { V2PluginContext } from "./types"
import type { V2RegistrationCollector } from "./registration-collector"
import { createLogOnce, createV1HookInvoker, type LogOnce } from "./registration-collector"

/**
 * Bridges the V1 `event` handler onto `ctx.event.subscribe(...)` (an async
 * iterable with `{ signal? }` request options; disposal aborts the loop via an
 * AbortController).
 *
 * Mapping is best-effort and prioritized by what momo's event handler actually
 * consumes (src/plugin/event.ts): session.idle, session.status, session
 * created/deleted lifecycle, session errors, compaction completion,
 * permission asks, filesystem changes, and installation updates. V2 kinds
 * with no faithful V1 counterpart (streaming deltas, inbox moves, tool
 * progress, TUI events, ...) are skipped with a log-once per kind.
 */
export async function registerEventHook(
  ctx: V2PluginContext,
  hooks: HooksWithRuntimeLifecycle,
  collector: V2RegistrationCollector,
): Promise<void> {
  const handler = hooks.event
  if (!handler) return

  const invoke = createV1HookInvoker()
  const logOnce = createLogOnce("v2-event-hook-bridge")
  const controller = new AbortController()

  void (async () => {
    try {
      const stream = await ctx.event.subscribe({ signal: controller.signal })
      for await (const event of stream) {
        const v1Event = mapV2EventToV1(event, logOnce)
        if (v1Event === undefined) continue
        await invoke("event", handler, { event: v1Event }, undefined)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        log("[v2-event-hook-bridge] event subscription failed", {
          error: error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error),
        })
      }
    }
  })()

  collector.add({
    dispose: async () => {
      controller.abort()
    },
  })
}

/** Exposed for tests; the bridge wires it against the live subscription loop. */
export function createV2EventToV1Mapper(logOnce: LogOnce): (event: V2Event) => V1Event | undefined {
  return (event) => mapV2EventToV1(event, logOnce)
}

function mapV2EventToV1(event: V2Event, logOnce: LogOnce): V1Event | undefined {
  switch (event.type) {
    case "session.idle":
      return { type: "session.idle", properties: { sessionID: event.data.sessionID } }
    case "session.status":
      return {
        type: "session.status",
        properties: { sessionID: event.data.sessionID, status: event.data.status },
      }
    case "session.created":
      return { type: "session.created", properties: { info: buildSessionView(event.created, event.data) } }
    case "session.deleted":
      return { type: "session.deleted", properties: { info: buildSessionView(event.created, event.data) } }
    case "session.execution.failed":
    case "session.step.failed":
      return {
        type: "session.error",
        properties: { sessionID: event.data.sessionID, error: buildV1Error(event.data.error) },
      }
    case "session.compaction.ended":
      return { type: "session.compacted", properties: { sessionID: event.data.sessionID } }
    case "permission.asked":
      return { type: "permission.updated", properties: buildPermissionView(event.created, event.data) }
    case "filesystem.changed":
      return {
        type: "file.watcher.updated",
        properties: {
          file: event.data.file,
          event: event.data.event,
        },
      }
    case "installation.updated":
      return { type: "installation.updated", properties: { version: event.data.version } }
    default:
      logOnce(`unmapped-kind:${event.type}`, `V2 event kind "${event.type}" has no faithful V1 mapping; skipped`, {})
      return undefined
  }
}

type SessionDataView = {
  sessionID: string
  projectID?: string
  location?: { directory: string }
  parentID?: string
  title?: string
  version?: string
}

function buildSessionView(created: number, data: SessionDataView): V1SdkSession {
  const parentID = data.parentID
  return {
    id: data.sessionID,
    projectID: data.projectID ?? "",
    directory: data.location?.directory ?? "",
    ...(parentID !== undefined ? { parentID } : {}),
    title: data.title ?? "",
    version: data.version ?? "",
    time: { created, updated: created },
  }
}

type V1EventError = NonNullable<Extract<V1Event, { type: "session.error" }>["properties"]["error"]>

function buildV1Error(error: unknown): V1EventError {
  const structured = isRecord(error) ? error : undefined
  const message =
    structured !== undefined && typeof structured["message"] === "string" ? structured["message"] : ""
  const type =
    structured !== undefined && typeof structured["type"] === "string" ? structured["type"].toLowerCase() : ""
  if (type.includes("auth")) {
    return { name: "ProviderAuthError", data: { providerID: "", message } }
  }
  if (type.includes("abort")) {
    return { name: "MessageAbortedError", data: { message } }
  }
  if (structured !== undefined && typeof structured["status"] === "number") {
    return { name: "APIError", data: { message, statusCode: structured["status"], isRetryable: false } }
  }
  return { name: "UnknownError", data: { message } }
}

function buildPermissionView(created: number, data: {
  id: string
  sessionID: string
  action: string
  metadata?: Record<string, unknown>
  message?: string
  source?: { messageID: string; id: string }
}): V1SdkPermission {
  const callID = data.source?.id
  return {
    id: data.id,
    type: data.action,
    sessionID: data.sessionID,
    messageID: data.source?.messageID ?? "",
    ...(callID !== undefined ? { callID } : {}),
    title: data.message ?? data.action,
    metadata: data.metadata ?? {},
    time: { created },
  }
}

