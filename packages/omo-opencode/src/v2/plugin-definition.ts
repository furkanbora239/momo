import { Plugin } from "@opencode/plugin"
import {
  assemblePluginRuntime,
  defaultPluginModuleDeps,
  type PluginAssemblyState,
} from "../testing/create-plugin-module"
import { createV2PluginInput } from "./client-bridge"
import { registerV2ConfigDomains } from "./config-bridge"
import { registerV2Hooks } from "./hook-bridge"
import { registerV2Tools } from "./tool-bridge"
import { createSessionStatusRegistry } from "./session-status-registry"
import type { V2Cleanup, V2PluginContext } from "./types"

export function createV2Setup(): (ctx: V2PluginContext) => Promise<V2Cleanup> {
  return async (ctx) => {
    const state: PluginAssemblyState = {}
    // One registry instance shared by the client bridge (status source) and the
    // event hook bridge (feeder) so both views stay consistent.
    const sessionStatusRegistry = createSessionStatusRegistry()
    const { pluginHooks } = await assemblePluginRuntime(
      defaultPluginModuleDeps,
      state,
      createV2PluginInput(ctx, sessionStatusRegistry),
    )
    await registerV2ConfigDomains(ctx, pluginHooks.config)
    const hookBridge = await registerV2Hooks(ctx, pluginHooks, sessionStatusRegistry)
    await registerV2Tools(ctx, pluginHooks.tool)
    return async () => {
      await hookBridge.dispose()
      await pluginHooks.dispose?.()
    }
  }
}

export function createV2PluginDefinition(): Plugin.Plugin {
  return Plugin.define({
    id: "oh-my-openagent",
    setup: createV2Setup(),
  })
}
