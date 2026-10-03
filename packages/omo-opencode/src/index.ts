import { createPluginModule } from "./testing/create-plugin-module"
import { ensureV1ToolSchemaRuntime } from "./v2/tool-schema-runtime"
import { createV2PluginDefinition } from "./v2/plugin-definition"

ensureV1ToolSchemaRuntime()

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
