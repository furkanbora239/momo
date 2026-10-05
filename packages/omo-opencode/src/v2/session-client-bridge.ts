import { log } from "../shared/logger"
import { createUnmappedNoOpMethod, toV1Result, type V1ClientResult } from "./client-bridge-result"
import { adaptSessionMessages, type V1AdaptedMessage } from "./session-message-adapter"
import type { SessionStatusRegistry } from "./session-status-registry"
import type { TodoItem, TodoRegistry } from "./todo-registry"
import type { V2PluginContext } from "./types"

/**
 * Kept verbatim from the original no-op mapping so the degraded path still
 * identifies itself in the log. Now fires only when the registry is wired but
 * has no entry for the requested session (or is entirely absent).
 */
const SESSION_STATUS_UNMAPPED_LOG =
  "[v2-client-bridge] session.status is not mapped under OpenCode V2 (the V2 plugin ctx exposes no session status API); degrading to no-op"

/**
 * Kept verbatim from the original no-op mapping so the degraded path still
 * identifies itself in the log. Now fires only when the registry is wired but
 * has no entry for the requested session (or is entirely absent).
 */
const SESSION_TODO_UNMAPPED_LOG =
  "[v2-client-bridge] session.todo is not mapped under OpenCode V2 (the V2 client has no todo API); degrading to no-op"

type V2SessionInfo = Awaited<ReturnType<V2PluginContext["session"]["get"]>>
type V2SessionCreateInput = Parameters<V2PluginContext["session"]["create"]>[0]

/** V1 nested options for `GET /session/{id}` (see session-creator.ts call sites). */
type V1SessionIdArgs = {
  path: { id: string }
  query?: { directory?: string }
}

/**
 * V1 nested options for `POST /session`. The V1 server accepts a create-body
 * model override even though the SDK type omits it (session-creator.ts passes
 * it via a Record cast), so the bridge types it explicitly.
 */
type V1SessionCreateArgs = {
  body?: {
    parentID?: string
    title?: string
    model?: { id?: string; providerID?: string; variant?: string }
  }
  query?: { directory?: string }
}

/** V1 nested options for `GET /session/{id}/message` (see sync-result-fetcher.ts). */
type V1SessionMessagesArgs = {
  path: { id: string }
  query?: { directory?: string; limit?: number }
}

/** V1 nested options for `POST /session/{id}/summarize` (see preemptive-compaction-trigger.ts). */
type V1SessionSummarizeArgs = {
  path: { id: string }
  body?: { providerID?: string; modelID?: string; auto?: boolean }
  query?: { directory?: string }
}

/** V1 nested options for `POST /session/{id}/prompt_async` (see spawner.ts + task-prompt-body.ts). */
type V1SessionPromptAsyncArgs = {
  path: { id: string }
  body?: {
    messageID?: string
    model?: { providerID?: string; modelID?: string }
    agent?: string
    system?: string
    tools?: Record<string, boolean>
    parts?: Array<{ type: string; text?: string }>
  }
  query?: { directory?: string }
}

export type SessionClientBridge = {
  get: (args: V1SessionIdArgs) => Promise<V1ClientResult<V2SessionInfo & { directory: string }>>
  create: (args: V1SessionCreateArgs) => Promise<V1ClientResult<V2SessionInfo & { directory: string }>>
  delete: (args: V1SessionIdArgs) => Promise<V1ClientResult<boolean>>
  abort: (args: V1SessionIdArgs) => Promise<V1ClientResult<boolean>>
  messages: (args: V1SessionMessagesArgs) => Promise<V1ClientResult<V1AdaptedMessage[]>>
  summarize: (args: V1SessionSummarizeArgs) => Promise<V1ClientResult<boolean>>
  promptAsync: (args: V1SessionPromptAsyncArgs) => Promise<V1ClientResult<undefined>>
  todo: (args: V1SessionIdArgs) => Promise<V1ClientResult<TodoItem[]> | undefined>
  status: (
    args?: { path?: { id?: string } },
  ) => Promise<V1ClientResult<Record<string, { type: string }> | { type: string } | undefined> | undefined>
  list: () => Promise<undefined>
  children: () => Promise<undefined>
  message: () => Promise<undefined>
}

/**
 * Bridges the V1 `client.session` surface momo uses onto the V2 ctx session
 * domain. Nested `{ path, query, body }` options flatten into the V2
 * parameters; V2 payloads wrap into the V1 `{ data, error }` envelope.
 *
 * Return-shape notes: V1 Session carries `directory`, derived from the V2
 * `location.directory`; V1 `messages` data is adapted from V2 session context
 * records (see session-message-adapter.ts); V1 `promptAsync` resolves void
 * (204), so the V2 inbox record is not surfaced.
 */
export function createSessionClientBridge(
  ctx: V2PluginContext,
  registry?: SessionStatusRegistry,
  todoRegistry?: TodoRegistry,
): SessionClientBridge {
  return {
    get: (args) =>
      toV1Result(async () =>
        adaptSessionInfo(await ctx.session.get({ sessionID: requireSessionID(args) })),
      ),
    create: (args) =>
      toV1Result(async () => adaptSessionInfo(await ctx.session.create(flattenSessionCreateArgs(args)))),
    delete: (args) =>
      toV1Result(async () => {
        await ctx.session.remove({ sessionID: requireSessionID(args) })
        return true
      }),
    abort: (args) =>
      toV1Result(async () => (await ctx.session.interrupt({ sessionID: requireSessionID(args) })).interrupted),
    messages: (args) =>
      toV1Result(async () => {
        const sessionID = requireSessionID(args)
        return adaptSessionMessages(await ctx.session.context({ sessionID }), sessionID)
      }),
    summarize: (args) =>
      toV1Result(async () => {
        const sessionID = requireSessionID(args)
        if (args.body?.providerID !== undefined || args.body?.modelID !== undefined) {
          log(
            "[v2-session-bridge] session.summarize model override has no V2 equivalent; compacting with the session model",
            { sessionID },
          )
        }
        await ctx.session.compact({ sessionID })
        return true
      }),
    promptAsync: (args) => toV1Result(() => dispatchV2Prompt(ctx, args)),
    todo: (args) => {
      if (todoRegistry === undefined) {
        log(SESSION_TODO_UNMAPPED_LOG)
        return Promise.resolve(undefined)
      }
      const id = args?.path?.id
      if (id === undefined || id.length === 0) {
        log(SESSION_TODO_UNMAPPED_LOG)
        return Promise.resolve(undefined)
      }
      const todos = todoRegistry.get(id)
      if (todos === undefined) {
        log(SESSION_TODO_UNMAPPED_LOG, { sessionID: id })
        return Promise.resolve(undefined)
      }
      return toV1Result(async () => todos)
    },
    status: (args) => {
      if (registry === undefined) {
        log(SESSION_STATUS_UNMAPPED_LOG)
        return Promise.resolve(undefined)
      }
      return toV1Result(async () => {
        const id = args?.path?.id
        if (id !== undefined) {
          const entry = registry.get(id)
          if (entry === undefined) {
            log(SESSION_STATUS_UNMAPPED_LOG, { sessionID: id })
            return undefined
          }
          return entry
        }
        return registry.map()
      })
    },
    list: createUnmappedNoOpMethod("session.list", "the V2 plugin ctx exposes no session list API"),
    children: createUnmappedNoOpMethod("session.children", "the V2 plugin ctx exposes no session children API"),
    message: createUnmappedNoOpMethod("session.message", "the V2 plugin ctx exposes no single-message API"),
  }
}

function requireSessionID(args: { path?: { id?: string } }): string {
  const id = args.path?.id
  if (typeof id !== "string" || id.length === 0) {
    throw new Error("v2 session client bridge requires a V1 path.id session id")
  }
  return id
}

function adaptSessionInfo(info: V2SessionInfo): V2SessionInfo & { directory: string } {
  return { ...info, directory: info.location.directory }
}

function flattenSessionCreateArgs(args: V1SessionCreateArgs): V2SessionCreateInput {
  const model = args.body?.model
  return {
    ...(args.body?.parentID !== undefined ? { parentID: args.body.parentID } : {}),
    ...(args.body?.title !== undefined ? { title: args.body.title } : {}),
    ...(model?.id !== undefined && model.providerID !== undefined
      ? {
          model: {
            id: model.id,
            providerID: model.providerID,
            ...(model.variant !== undefined ? { variant: model.variant } : {}),
          },
        }
      : {}),
    ...(args.query?.directory !== undefined ? { location: { directory: args.query.directory } } : {}),
  }
}

async function dispatchV2Prompt(
  ctx: V2PluginContext,
  args: V1SessionPromptAsyncArgs,
): Promise<undefined> {
  const sessionID = requireSessionID(args)
  const body = args.body
  if (body?.agent !== undefined) {
    await ctx.session.switchAgent({ sessionID, agent: body.agent })
  }
  if (body?.model !== undefined && body.model.providerID !== undefined && body.model.modelID !== undefined) {
    await ctx.session.switchModel({
      sessionID,
      model: { id: body.model.modelID, providerID: body.model.providerID },
    })
  }
  if (body?.system !== undefined) {
    log("[v2-session-bridge] promptAsync system override has no V2 equivalent; dropped", { sessionID })
  }
  if (body?.tools !== undefined) {
    log("[v2-session-bridge] promptAsync tools override has no V2 equivalent; dropped", { sessionID })
  }
  const textParts = (body?.parts ?? []).filter(
    (part): part is { type: "text"; text: string } =>
      part.type === "text" && typeof part.text === "string",
  )
  const text = textParts.map((part) => part.text).join("\n")
  if (text.length === 0) {
    log("[v2-session-bridge] promptAsync carried no text parts; nothing delivered", { sessionID })
    return undefined
  }
  await ctx.session.prompt({ sessionID, text })
  return undefined
}
