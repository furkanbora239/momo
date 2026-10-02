import { createPluginModule } from "./testing/create-plugin-module"
import { createV2PluginDefinition } from "./v2/plugin-definition"

const pluginModule = createPluginModule()

export const omoPlugin = pluginModule.server

export default {
  ...createV2PluginDefinition(),
  server: pluginModule.server,
}

export type {
  AgentName,
  AgentOverrideConfig,
  AgentOverrides,
  BuiltinCommandName,
  HookName,
  McpName,
  OhMyOpenCodeConfig,
} from "./config"

export type { ConfigLoadError } from "./shared/config-errors"
