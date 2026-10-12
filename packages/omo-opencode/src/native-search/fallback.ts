import { existsSync } from "node:fs"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode/plugin"
import type { Mcp } from "@opencode/plugin"
import { resolveRuntimeExecutable } from "../mcp/runtime-executable"
import type { NativeRole } from "../native-routing/types"
import { resolveNativeOmoDirectory } from "../native-catalog/paths"

export const NATIVE_SEARCH_FALLBACK_SERVER_IDS = {
  lsp: "momo_lsp",
  astGrep: "momo_ast_grep",
} as const

export const NATIVE_SEARCH_READ_TOOLS = [
  "mcp__momo_lsp__status",
  "mcp__momo_lsp__diagnostics",
  "mcp__momo_lsp__goto_definition",
  "mcp__momo_lsp__find_references",
  "mcp__momo_lsp__symbols",
  "mcp__momo_ast_grep__search",
  "mcp__momo_ast_grep__scan",
] as const

export const NATIVE_SEARCH_WRITE_TOOLS = [
  "mcp__momo_lsp__rename",
  "mcp__momo_ast_grep__rewrite",
] as const

const READ_ONLY_ROLES = new Set<NativeRole>([
  "orchestrator", "planner", "executor", "reviewer", "advisor", "explore", "librarian", "research", "catalog-researcher",
])

export function nativeSearchToolsForRole(role: NativeRole): readonly string[] {
  return READ_ONLY_ROLES.has(role)
    ? NATIVE_SEARCH_READ_TOOLS
    : [...NATIVE_SEARCH_READ_TOOLS, ...NATIVE_SEARCH_WRITE_TOOLS]
}

export interface NativeSearchFallbackOptions {
  readonly cwd: string
  readonly homeDirectory?: string
  readonly workspaceRoot?: string
  readonly moduleUrl?: string
  readonly lspCommand?: readonly string[]
  readonly astGrepCommand?: readonly string[]
  readonly exists?: (path: string) => boolean
}

function resolveWorkspaceRoot(options: NativeSearchFallbackOptions): string | undefined {
  const pathExists = options.exists ?? existsSync
  if (options.workspaceRoot) return resolve(options.workspaceRoot)
  let current = dirname(fileURLToPath(options.moduleUrl ?? import.meta.url))
  for (let depth = 0; depth < 10; depth += 1) {
    if (pathExists(join(current, "packages/lsp-tools-mcp/dist/cli.js")) ||
        pathExists(join(current, "packages/ast-grep-mcp/dist/cli.js"))) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return undefined
}

function resolveNodeCli(cli: string, options: NativeSearchFallbackOptions): readonly string[] | undefined {
  const pathExists = options.exists ?? existsSync
  const runtime = resolveRuntimeExecutable("node")
  if (!pathExists(cli) || !runtime.available) return undefined
  return [runtime.command, cli, "mcp"]
}

export function createNativeSearchFallbackConfigs(options: NativeSearchFallbackOptions): Readonly<Record<string, Mcp.ServerConfig>> {
  const workspaceRoot = resolveWorkspaceRoot(options)
  const lspDist = workspaceRoot ? join(workspaceRoot, "packages/lsp-tools-mcp/dist/cli.js") : ""
  const astGrepDist = workspaceRoot ? join(workspaceRoot, "packages/ast-grep-mcp/dist/cli.js") : ""
  const lspCommand = options.lspCommand ?? (lspDist ? resolveNodeCli(lspDist, options) : undefined)
  const astGrepCommand = options.astGrepCommand ?? (astGrepDist ? resolveNodeCli(astGrepDist, options) : undefined)
  const omoDirectory = resolveNativeOmoDirectory(options.homeDirectory)
  const projectConfig = [".opencode/lsp.json", ".omo/lsp.json", ".omo/lsp-client.json"]
    .map((path) => resolve(options.cwd, path)).join(delimiter)
  return {
    [NATIVE_SEARCH_FALLBACK_SERVER_IDS.lsp]: {
      type: "local",
      command: [...(lspCommand ?? ["node", lspDist, "mcp"])],
      cwd: options.cwd,
      environment: {
        LSP_TOOLS_MCP_PROJECT_CONFIG: projectConfig,
        LSP_TOOLS_MCP_USER_CONFIG: join(omoDirectory, "native", "lsp.json"),
        LSP_TOOLS_MCP_INSTALL_DECISIONS: join(omoDirectory, "native", "lsp-install-decisions.json"),
      },
      disabled: lspCommand === undefined,
    },
    [NATIVE_SEARCH_FALLBACK_SERVER_IDS.astGrep]: {
      type: "local",
      command: [...(astGrepCommand ?? ["node", astGrepDist, "mcp"])],
      cwd: options.cwd,
      disabled: astGrepCommand === undefined,
    },
  }
}

export async function registerNativeSearchFallbacks(
  context: Pick<Plugin.Context, "mcp">,
  options: NativeSearchFallbackOptions,
): Promise<() => Promise<void>> {
  const configs = createNativeSearchFallbackConfigs(options)
  const registration = await context.mcp.transform((editor) => {
    for (const [name, config] of Object.entries(configs)) editor.set(name, config)
  })
  return () => registration.dispose()
}
