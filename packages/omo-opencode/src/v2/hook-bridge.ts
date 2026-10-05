import type { HooksWithRuntimeLifecycle } from "../testing/create-plugin-module"
import type { V2PluginContext } from "./types"
import type { SessionStatusRegistry } from "./session-status-registry"
import { createRegistrationCollector, type V2RegistrationCollector } from "./registration-collector"
import { registerEventHook } from "./event-hook-bridge"
import { registerPermissionHooks } from "./permission-hook-bridge"
import { registerSessionCompactionHooks } from "./session-compaction-hook-bridge"
import { registerSessionContextHooks } from "./session-context-hook-bridge"
import { registerSessionModelRequestHooks } from "./session-model-request-hook-bridge"
import { registerSessionPromptHooks } from "./session-prompt-hook-bridge"
import { registerShellHooks } from "./shell-hook-bridge"
import { registerToolHooks } from "./tool-hook-bridge"

export interface V2HookBridge {
  dispose: () => Promise<void>
}

/**
 * Registers every V1 momo hook the OpenCode V2 runtime has a faithful hook
 * domain for, collecting each `Registration` so `dispose` tears everything
 * down. Keys `dispose`, `config`, and `tool` (definition registry) belong to
 * the other bridges and are intentionally not handled here.
 */
export async function registerV2Hooks(
  ctx: V2PluginContext,
  hooks: HooksWithRuntimeLifecycle,
  registry?: SessionStatusRegistry,
): Promise<V2HookBridge> {
  const collector = createRegistrationCollector()

  await registerSessionPromptHooks(ctx, hooks, collector)
  await registerSessionContextHooks(ctx, hooks, collector)
  await registerSessionModelRequestHooks(ctx, hooks, collector)
  await registerSessionCompactionHooks(ctx, hooks, collector)
  await registerToolHooks(ctx, hooks, collector)
  await registerEventHook(ctx, hooks, collector, registry)
  await registerShellHooks(ctx, hooks, collector)
  await registerPermissionHooks(ctx, hooks, collector)

  return {
    dispose: () => collector.disposeAll(),
  }
}
