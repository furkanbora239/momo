import type { HooksWithRuntimeLifecycle } from "../testing/create-plugin-module"
import type { V2PluginContext } from "./types"
import type { V2RegistrationCollector } from "./registration-collector"
import { createV1HookInvoker } from "./registration-collector"

/**
 * Bridges `permission.ask` onto `ctx.permission.hook("evaluate", ...)`.
 *
 * V1 input view over PermissionEvaluation (permission.d.ts): `action` becomes
 * the V1 `type`, the `tool` source decodes into `messageID`/`callID`, and
 * `title` prefers the evaluation message. V1 output `{ status }` writes
 * straight onto the mutable `e.effect` field (identical literal union).
 */
export async function registerPermissionHooks(
  ctx: V2PluginContext,
  hooks: HooksWithRuntimeLifecycle,
  collector: V2RegistrationCollector,
): Promise<void> {
  const handler = hooks["permission.ask"]
  if (!handler) return

  const invoke = createV1HookInvoker()
  collector.add(
    await ctx.permission.hook("evaluate", async (event) => {
      const status: "ask" | "deny" | "allow" = event.effect
      await invoke(
        "permission.ask",
        handler,
        {
          id: "",
          type: event.action,
          sessionID: event.sessionID,
          messageID: event.source?.messageID ?? "",
          ...(event.source !== undefined ? { callID: event.source.id } : {}),
          title: event.message ?? event.action,
          metadata: event.metadata ?? {},
          time: { created: Date.now() },
        },
        { status },
      )
      event.effect = status
    }),
  )
}
