import { createWebsearchConfig } from "./websearch"
import { context7 } from "./context7"
import { grep_app } from "./grep-app"
import { createCodegraphMcpConfig, type CodegraphMcpConfigOptions } from "./codegraph"
import { createLspMcpConfig, type LocalMcpConfig } from "./lsp"
import { createCatalogMcpConfig, type CatalogPrefer } from "./model-catalog"
import type { RuntimeExecutableResolver } from "./runtime-executable"
import type { CodegraphConfig } from "../config/schema/codegraph"
import type { Context7ConfigInput } from "../config/schema/context7"
import type { GrepAppConfigInput } from "../config/schema/grep-app"
import type { WebsearchConfigInput } from "../config/schema/websearch"

export { McpNameSchema, type McpName } from "./types"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

type BuiltinMcpConfig = RemoteMcpConfig | LocalMcpConfig

type BuiltinMcpOptions = {
  readonly codegraph?: Pick<
    CodegraphMcpConfigOptions,
    "env" | "fileExists" | "homeDir" | "provisioned" | "requireResolve"
  >
  readonly cwd?: string
  readonly resolveExecutable?: RuntimeExecutableResolver
}

type BuiltinMcpSourceConfig = {
  readonly codegraph?: Partial<CodegraphConfig>
  readonly disabled_tools?: readonly string[]
  readonly websearch?: WebsearchConfigInput
  readonly context7?: Context7ConfigInput
  readonly grep_app?: GrepAppConfigInput
  readonly catalog?: { enabled?: boolean; prefer?: CatalogPrefer; prefer_providers?: readonly string[] }
}

export function createBuiltinMcps(disabledMcps: string[] = [], config?: BuiltinMcpSourceConfig, options: BuiltinMcpOptions = {}) {
  const mcps: Record<string, BuiltinMcpConfig> = {}

  if (!disabledMcps.includes("websearch") && config?.websearch?.enabled === true) {
    const websearchConfig = createWebsearchConfig(config?.websearch)
    if (websearchConfig) {
      mcps.websearch = websearchConfig
    }
  }

  if (!disabledMcps.includes("context7") && config?.context7?.enabled === true) {
    mcps.context7 = context7
  }

  if (!disabledMcps.includes("grep_app") && config?.grep_app?.enabled === true) {
    mcps.grep_app = grep_app
  }

  if (!disabledMcps.includes("lsp")) {
    mcps.lsp = createLspMcpConfig({
      cwd: options.cwd,
      resolveExecutable: options.resolveExecutable,
    })
  }

  if (!disabledMcps.includes("codegraph") && config?.codegraph?.enabled !== false) {
    mcps.codegraph = createCodegraphMcpConfig({
      config: config?.codegraph,
      cwd: options.cwd,
      ...options.codegraph,
      resolveExecutable: options.resolveExecutable,
    })
  }

  if (!disabledMcps.includes("catalog") && config?.catalog?.enabled !== false) {
    mcps.catalog = createCatalogMcpConfig({
      prefer: config?.catalog?.prefer,
      preferProviders: config?.catalog?.prefer_providers,
      resolveExecutable: options.resolveExecutable,
    })
  }

  return mcps
}
