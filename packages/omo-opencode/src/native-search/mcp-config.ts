import type { Mcp } from "@opencode/plugin"
import { resolveNativeSearchBinary } from "./runtime"

export interface NativeSearchMcpConfigOptions {
  readonly enabled?: boolean
  readonly runtimeRoot: string
  readonly cacheRoot: string
  readonly allowedRoot: string
  readonly platform?: NodeJS.Platform
  readonly arch?: string
}

/** Builds the native V2 MCP config directly. It never routes through the V1 SDK converter. */
export async function createNativeSearchMcpConfig(options: NativeSearchMcpConfigOptions): Promise<Mcp.ServerConfig> {
  const binary = await resolveNativeSearchBinary(options)
  const enabled = options.enabled === true && binary !== undefined
  return {
    type: "local",
    command: [binary ?? "codebase-memory-mcp", "serve", "--mcp"],
    environment: {
      CBM_CACHE_DIR: options.cacheRoot,
      CBM_RUNTIME_DIR: options.runtimeRoot,
      CBM_ALLOWED_ROOT: options.allowedRoot,
      CBM_LOG_LEVEL: "warn",
    },
    disabled: !enabled,
  }
}
