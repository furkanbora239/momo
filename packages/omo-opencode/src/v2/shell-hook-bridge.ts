import type { HooksWithRuntimeLifecycle } from "../testing/create-plugin-module"
import type { V2PluginContext } from "./types"
import type { V2RegistrationCollector } from "./registration-collector"
import { createV1HookInvoker } from "./registration-collector"

/**
 * Bridges `shell.env` onto `ctx.shell.hook("create.before", ...)`. The V1
 * output `{ env }` merges into the mutable `e.env` record. The V2 event
 * carries no `sessionID`/`callID`, so the V1 input degrades to `{ cwd }` only.
 */
export async function registerShellHooks(
  ctx: V2PluginContext,
  hooks: HooksWithRuntimeLifecycle,
  collector: V2RegistrationCollector,
): Promise<void> {
  const handler = hooks["shell.env"]
  if (!handler) return

  const invoke = createV1HookInvoker()
  collector.add(
    await ctx.shell.hook("create.before", async (event) => {
      const env: Record<string, string> = {}
      await invoke("shell.env", handler, { cwd: event.cwd }, { env })
      for (const [key, value] of Object.entries(env)) {
        event.env[key] = value
      }
    }),
  )
}
