import type { HooksWithRuntimeLifecycle } from "../testing/create-plugin-module"
import type { V2PluginContext } from "./types"

type RecordedRegistration = {
  domain: string
  hook: string
  callback: (input: never) => Promise<void> | void
  disposed: boolean
}

/**
 * Fake V2 plugin ctx shared by the hook-bridge tests: every hook domain
 * records its registration (with an observable dispose) so the tests can fire
 * the registered V2 callbacks with synthetic V2 events.
 */
export type HookBridgeTestHarness = {
  ctx: V2PluginContext
  registrations: RecordedRegistration[]
  transformCalls: Array<(editor: unknown) => void>
  pushEvent: (event: unknown) => void
  getSubscribeSignal: () => AbortSignal | undefined
}

export function createHookBridgeTestHarness(args: {
  session?: Record<string, unknown>
  events?: unknown[]
} = {}): HookBridgeTestHarness {
  const registrations: RecordedRegistration[] = []
  const transformCalls: Array<(editor: unknown) => void> = []
  const subscribeCalls: Array<{ signal?: AbortSignal }> = []
  let eventSink: ((event: unknown) => void) | undefined
  let subscribeSignal: AbortSignal | undefined

  const recordingHook = (domain: string) => async (hook: string, callback: (input: never) => Promise<void> | void) => {
    const registration: RecordedRegistration = { domain, hook, callback, disposed: false }
    registrations.push(registration)
    return {
      dispose: async () => {
        registration.disposed = true
      },
    }
  }

  const ctx = {
    location: { directory: "/repo", project: { id: "proj-1", directory: "/repo", canonical: "/repo" } },
    session: {
      get: async (input: unknown) => {
        void input
        return args.session ?? { id: "sess-1", agent: "build", model: { id: "glm", providerID: "opencode-go" } }
      },
      hook: recordingHook("session"),
    },
    tool: {
      hook: recordingHook("tool"),
      transform: async (callback: (editor: unknown) => void) => {
        transformCalls.push(callback)
        return {
          dispose: async () => {},
        }
      },
    },
    shell: { hook: recordingHook("shell") },
    permission: { hook: recordingHook("permission") },
    event: {
      subscribe: async (requestOptions?: { signal?: AbortSignal }) => {
        subscribeCalls.push(requestOptions ?? {})
        subscribeSignal = requestOptions?.signal
        const queue = [...(args.events ?? [])]
        eventSink = (event: unknown) => queue.push(event)
        const next = async (): Promise<IteratorResult<unknown>> => {
          while (!subscribeSignal?.aborted && queue.length === 0) {
            await new Promise((resolve) => setTimeout(resolve, 5))
          }
          if (subscribeSignal?.aborted) throw new Error("aborted")
          const nextEvent = queue.shift()
          if (nextEvent === undefined) return { done: true, value: undefined }
          return { done: false, value: nextEvent }
        }
        const stream: AsyncIterable<unknown> = { [Symbol.asyncIterator]: () => ({ next }) }
        return stream
      },
    },
  } as unknown as V2PluginContext

  return {
    ctx,
    registrations,
    transformCalls,
    pushEvent: (event: unknown) => eventSink?.(event),
    getSubscribeSignal: () => subscribeSignal,
  }
}

/**
 * Synthetic handlers covering every V1 key the hook bridge maps. Handlers are
 * synthetic (never real momo prompt text) and mutate their outputs so the
 * tests can assert flow-back behavior. Signatures stay loose because the
 * bridges invoke the strict V1 handlers through their own normalized views.
 */
export type SyntheticChatMessagePart = {
  type: string
  text?: string
  id?: string
  sessionID?: string
  messageID?: string
  synthetic?: boolean
  state?: unknown
  callID?: string
  tool?: string
  [key: string]: unknown
}

export function syntheticHandlers(overrides: Partial<HooksWithRuntimeLifecycle> = {}): HooksWithRuntimeLifecycle {
  return {
    "chat.message": async (input: unknown, output: { message: Record<string, unknown>; parts: SyntheticChatMessagePart[] }) => {
      void input
      output.parts.push({ id: "synthetic_1", sessionID: "sess-1", messageID: "msg-1", type: "text", text: "INJECTED" })
    },
    "chat.params": async (_input: unknown, output: { temperature?: number; options: Record<string, unknown> }) => {
      output.temperature = 0.4
      output.options.reasoningEffort = "high"
    },
    "experimental.chat.system.transform": async (_input: unknown, output: { system: string[] }) => {
      output.system.push("SYNTHETIC-DIRECTIVE")
    },
    "experimental.chat.messages.transform": async (_input: unknown, output: { messages: Array<{ info: Record<string, unknown>; parts: SyntheticChatMessagePart[] }> }) => {
      const userView = output.messages.find((message) => message.info.role === "user")
      const textPart = userView?.parts.find((part) => part.type === "text")
      if (textPart !== undefined) {
        textPart.text = "TRANSLATED"
      }
      output.messages.push({
        info: {
          id: "synthetic_msg",
          sessionID: "sess-1",
          role: "user",
          time: { created: 1 },
          agent: "default",
          model: { providerID: "", modelID: "" },
        },
        parts: [{ id: "synthetic_part", sessionID: "sess-1", messageID: "synthetic_msg", type: "text", text: "REPO-MAP" }],
      })
    },
    "chat.headers": async (_input: unknown, output: { headers: Record<string, string> }) => {
      output.headers["x-initiator"] = "agent"
    },
    "experimental.session.compacting": async (_input: unknown, output: { context: string[] }) => {
      output.context.push("COMPACT-CONTEXT")
    },
    "tool.execute.before": async (_input: unknown, output: { args: Record<string, unknown> }) => {
      output.args.command = "MUTATED"
    },
    "tool.execute.after": async (_input: unknown, output: { title: string; output: string; metadata: Record<string, unknown> }) => {
      output.output = `${output.output}\nGUIDANCE`
      output.metadata.flag = true
    },
    "tool.definition": async (input: { toolID: string }, output: { description: string; parameters: unknown }) => {
      if (input.toolID === "todowrite") output.description = "OVERRIDE"
    },
    event: async () => {},
    ...overrides,
  } as unknown as HooksWithRuntimeLifecycle
}

export function fireRegistration(registration: RecordedRegistration, input: unknown): Promise<void> {
  return Promise.resolve(registration.callback(input as never))
}

export function registrationsFor(
  harness: HookBridgeTestHarness,
  domain: string,
  hook: string,
): RecordedRegistration[] {
  return harness.registrations.filter(
    (registration) => registration.domain === domain && registration.hook === hook,
  )
}
