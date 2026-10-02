import type { HooksWithRuntimeLifecycle } from "../testing/create-plugin-module"
import type { SessionContext } from "@opencode/plugin/promise/session"
import type { V2PluginContext } from "./types"
import type { V1PairHook, V2RegistrationCollector } from "./registration-collector"
import { createLogOnce, createV1HookInvoker } from "./registration-collector"
import {
  buildContextMessageViews,
} from "./context-message-adapter"
import { applyContextMessageWriteBack } from "./context-message-write-back"

const GENERATION_OPTION_KEYS = new Set([
  "maxTokens",
  "temperature",
  "topP",
  "topK",
  "frequencyPenalty",
  "presencePenalty",
  "seed",
  "stop",
])

/**
 * Bridges `chat.params`, `experimental.chat.system.transform`, and
 * `experimental.chat.messages.transform` onto ONE V2 domain:
 * `ctx.session.hook("context", ...)`. Each V1 hook gets its own registration
 * so disposal is independent; the runtime invokes them in registration order.
 *
 * The assembled momo handlers under `chat.params` / `chat.headers` read their
 * inputs defensively (unknown-first normalization in plugin-interface.ts and
 * chat-params.ts), so the bridge invokes them with degraded minimal views
 * through a documented handler-side cast instead of fabricating full V1 SDK
 * Model/ProviderContext records.
 */
export async function registerSessionContextHooks(
  ctx: V2PluginContext,
  hooks: HooksWithRuntimeLifecycle,
  collector: V2RegistrationCollector,
): Promise<void> {
  const logOnce = createLogOnce("v2-context-hook-bridge")
  const invoke = createV1HookInvoker()

  collector.add(
    await ctx.session.hook("context", async (event) => {
      await bridgeChatParams(invoke, hooks, event, logOnce)
    }),
  )

  collector.add(
    await ctx.session.hook("context", async (event) => {
      await bridgeSystemTransform(invoke, hooks, event)
    }),
  )

  collector.add(
    await ctx.session.hook("context", async (event) => {
      await bridgeMessagesTransform(invoke, hooks, event, logOnce)
    }),
  )
}

type ContextEvent = SessionContext

type ChatParamsBridgeInput = {
  sessionID: string
  agent: string
  model: { providerID: string; modelID: string }
  provider: { id: string }
  message: { variant?: string }
}

type ChatParamsBridgeOutput = {
  temperature?: number
  topP?: number
  topK?: number
  maxOutputTokens?: number
  options: Record<string, unknown>
}

async function bridgeChatParams(
  invoke: ReturnType<typeof createV1HookInvoker>,
  hooks: HooksWithRuntimeLifecycle,
  event: ContextEvent,
  logOnce: ReturnType<typeof createLogOnce>,
): Promise<void> {
  const handler = hooks["chat.params"] as unknown as
    | V1PairHook<ChatParamsBridgeInput, ChatParamsBridgeOutput>
    | undefined
  if (!handler) return

  const output: ChatParamsBridgeOutput = {
    temperature: readNumber(event.options.temperature),
    topP: readNumber(event.options.topP),
    topK: readNumber(event.options.topK),
    maxOutputTokens: readNumber(event.options.maxTokens),
    options: { ...providerOptions(event.options) },
  }
  await invoke(
    "chat.params",
    handler,
    {
      sessionID: event.sessionID,
      agent: event.agent,
      model: { providerID: event.model.providerID, modelID: event.model.id },
      provider: { id: event.model.providerID },
      message: { variant: readString(event.model.variant) },
    },
    output,
  )

  writeBackGenerationOption(event.options, "temperature", output.temperature, logOnce)
  writeBackGenerationOption(event.options, "topP", output.topP, logOnce)
  writeBackGenerationOption(event.options, "topK", output.topK, logOnce)
  writeBackGenerationOption(event.options, "maxTokens", output.maxOutputTokens, logOnce)
  for (const [key, value] of Object.entries(output.options)) {
    event.options[key] = value
  }
}

function writeBackGenerationOption(
  options: { [key: string]: unknown },
  key: string,
  value: number | undefined,
  logOnce: ReturnType<typeof createLogOnce>,
): void {
  if (typeof value === "number") {
    options[key] = value
    return
  }
  if (key in options) {
    logOnce(`option-deleted:${key}`, `V1 handler removed ${key}; deleting it from the V2 request options`, {})
    delete options[key]
  }
}

function providerOptions(options: { [key: string]: unknown }): Record<string, unknown> {
  const provider: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(options)) {
    if (!GENERATION_OPTION_KEYS.has(key)) provider[key] = value
  }
  return provider
}

async function bridgeSystemTransform(
  invoke: ReturnType<typeof createV1HookInvoker>,
  hooks: HooksWithRuntimeLifecycle,
  event: ContextEvent,
): Promise<void> {
  const handler = hooks["experimental.chat.system.transform"] as unknown as
    | V1PairHook<SystemTransformBridgeInput, { system: string[] }>
    | undefined
  if (!handler) return
  const system: string[] = []
  await invoke(
    "experimental.chat.system.transform",
    handler,
    { sessionID: event.sessionID, model: { id: event.model.id, providerID: event.model.providerID } },
    { system },
  )
  for (const text of system) {
    event.system.push({ type: "text", text })
  }
}

type SystemTransformBridgeInput = {
  sessionID?: string
  model: { id: string; providerID: string }
}

async function bridgeMessagesTransform(
  invoke: ReturnType<typeof createV1HookInvoker>,
  hooks: HooksWithRuntimeLifecycle,
  event: ContextEvent,
  logOnce: ReturnType<typeof createLogOnce>,
): Promise<void> {
  const handler = hooks["experimental.chat.messages.transform"]
  if (!handler) return
  const built = buildContextMessageViews(event.sessionID, event.messages, logOnce)
  await invoke("experimental.chat.messages.transform", handler, {}, { messages: built.views })
  applyContextMessageWriteBack(event, built, built.views, logOnce)
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}
