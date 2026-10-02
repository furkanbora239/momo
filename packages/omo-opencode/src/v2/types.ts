import type { Plugin } from "@opencode/plugin"

export type V2PluginContext = Plugin.Context
export type V2Cleanup = Plugin.Cleanup
export type V2PluginDefinition = Plugin.Plugin
export type V2Registration = { readonly dispose: () => Promise<void> }
