import type { HooksWithRuntimeLifecycle } from "../testing/create-plugin-module"
import type { V2PluginContext } from "./types"
import type { V1PairHook, V2RegistrationCollector } from "./registration-collector"
import { createV1HookInvoker } from "./registration-collector"

/**
 * Bridges `chat.headers` onto `ctx.session.hook("model.request", ...)`. The V1
 * output `{ headers }` mutations flow into the mutable `e.headers` record.
 *
 * The assembled momo handler (chat-headers.ts) reads its inputs defensively
 * (unknown-first normalization), so the bridge invokes it with a degraded
 * minimal view through a documented handler-side cast: `model.api` and the
 * per-request `message.id` have no V2 SessionModelRequest equivalent, so the
 * Copilot npm-package guard and the internal-marker lookup degrade to inert.
 */
export async function registerSessionModelRequestHooks(
  ctx: V2PluginContext,
  hooks: HooksWithRuntimeLifecycle,
  collector: V2RegistrationCollector,
): Promise<void> {
  const invoke = createV1HookInvoker()
  const handler = hooks["chat.headers"] as unknown as
    | V1PairHook<HeadersBridgeInput, HeadersBridgeOutput>
    | undefined
  if (!handler) return

  collector.add(
    await ctx.session.hook("model.request", async (event) => {
      const headers: Record<string, string> = {}
      await invoke(
        "chat.headers",
        handler,
        {
          sessionID: event.sessionID,
          agent: event.agent,
          model: { providerID: event.model.providerID, modelID: event.model.id },
          provider: { id: event.model.providerID },
          message: { role: "user" },
        },
        { headers },
      )
      for (const [key, value] of Object.entries(headers)) {
        event.headers[key] = value
      }
    }),
  )
}

type HeadersBridgeInput = {
  sessionID: string
  agent: string
  model: { providerID: string; modelID: string }
  provider: { id: string }
  message: { id?: string; role?: string }
}

type HeadersBridgeOutput = {
  headers: Record<string, string>
}
