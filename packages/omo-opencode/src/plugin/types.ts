import type { Plugin, ToolDefinition } from "@opencode-ai/plugin"
import type { TmuxConfig } from "@oh-my-opencode/tmux-core"

export type PluginContext = Omit<Parameters<Plugin>[0], "serverUrl"> & {
  /**
   * OpenCode V1 always provides the local server URL. The V2 runtime has no
   * single server URL to hand to plugins, so V2-built inputs leave this
   * unset and every consumer must degrade gracefully.
   */
  serverUrl?: URL
}
export type PluginInstance = Awaited<ReturnType<Plugin>>

type ChatHeadersHook = PluginInstance extends { "chat.headers"?: infer T }
  ? T
  : (input: unknown, output: unknown) => Promise<void>

export type PluginInterface = Omit<
  PluginInstance,
  "experimental.session.compacting" | "chat.headers"
> & {
  "chat.headers"?: ChatHeadersHook
}

export type ToolsRecord = Record<string, ToolDefinition>

export type { TmuxConfig }
