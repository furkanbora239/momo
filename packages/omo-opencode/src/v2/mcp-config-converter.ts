// mcp-config-converter.ts — pure converters between momo's V1 MCP entries and
// the V2 `Mcp.ServerConfig` shapes.
//
// V1 sources: SDK `McpLocalConfig` / `McpRemoteConfig` plus momo's builtin
// shapes from src/mcp/index.ts (LocalMcpConfig carries an explicit `enabled`
// and `cwd`). V2 ground truth: `Mcp.LocalConfig` / `Mcp.RemoteConfig` /
// `Mcp.TimeoutConfig` from @opencode/schema (grounded from dist mcp.d.ts):
// `disabled` is the INVERSE of the V1 `enabled` flag, and the flat V1 timeout
// (ms to fetch tools) lands on the `catalog` timeout.

import type { Mcp } from "@opencode/plugin"
import type { McpLocalConfig, McpRemoteConfig } from "@opencode-ai/sdk"

export type V1McpEntry = McpLocalConfig | McpRemoteConfig

export interface V1McpSeedEntry {
  readonly type?: "local" | "remote"
  readonly enabled?: boolean
}

export interface V2McpTimeout {
  readonly startup?: number
  readonly catalog?: number
  readonly execution?: number
}

interface V1McpEntryView {
  readonly type?: unknown
  readonly command?: unknown
  readonly url?: unknown
  readonly enabled?: unknown
  readonly headers?: unknown
  readonly timeout?: unknown
  readonly environment?: unknown
  readonly cwd?: unknown
  readonly oauth?: unknown
}

function asRecord(value: unknown): V1McpEntryView {
  return (typeof value === "object" && value !== null ? value : {}) as V1McpEntryView
}

function readCommandArray(command: unknown): string[] | undefined {
  if (Array.isArray(command)) {
    return command.filter((item): item is string => typeof item === "string")
  }
  if (typeof command === "string" && command.length > 0) {
    return [command]
  }
  return undefined
}

function convertV1Timeout(timeout: unknown): { timeout: V2McpTimeout } | Record<string, never> {
  return typeof timeout === "number" && Number.isFinite(timeout)
    ? { timeout: { catalog: timeout } }
    : {}
}

function convertV1OAuth(oauth: unknown): { oauth: Mcp.RemoteConfig["oauth"] } | Record<string, never> {
  if (oauth === false) return { oauth: false }
  if (typeof oauth !== "object" || oauth === null) return {}
  const record = oauth as { clientId?: unknown; clientSecret?: unknown; scope?: unknown }
  const converted: Record<string, string> = {}
  if (typeof record.clientId === "string") converted.client_id = record.clientId
  if (typeof record.clientSecret === "string") converted.client_secret = record.clientSecret
  if (typeof record.scope === "string") converted.scope = record.scope
  return Object.keys(converted).length > 0 ? { oauth: converted as Mcp.RemoteConfig["oauth"] } : {}
}

/** V1 MCP entry -> V2 ServerConfig (tagged local/remote union member). */
export function convertV1McpEntry(entry: V1McpEntry): Mcp.ServerConfig {
  const view = asRecord(entry)
  const disabled = view.enabled === false
  if (view.type === "remote") {
    const url = typeof view.url === "string" ? view.url : ""
    const headers =
      typeof view.headers === "object" && view.headers !== null
        ? (view.headers as Record<string, string>)
        : undefined
    return {
      type: "remote",
      url,
      ...(headers !== undefined ? { headers } : {}),
      ...convertV1OAuth(view.oauth),
      ...convertV1Timeout(view.timeout),
      disabled,
    }
  }
  const command = readCommandArray(view.command) ?? []
  const environment =
    typeof view.environment === "object" && view.environment !== null
      ? (view.environment as Record<string, string>)
      : undefined
  return {
    type: "local",
    command,
    ...(typeof view.cwd === "string" ? { cwd: view.cwd } : {}),
    ...(environment !== undefined ? { environment } : {}),
    ...convertV1Timeout(view.timeout),
    disabled,
  }
}

/** V2 mcp list server (name + status only) -> V1-shaped seed entry. */
export function convertV2McpServerToV1Seed(server: {
  readonly status: { readonly status: string }
}): V1McpSeedEntry {
  return { enabled: server.status.status !== "disabled" }
}

/**
 * Compare only the fields the V1 seed can know for an existing server
 * (enabled); full configs are only pushed for servers absent from the seed,
 * since the V2 mcp list does not expose server configs.
 */
export function mcpSeedEntryChanged(
  seed: V1McpSeedEntry,
  post: V1McpEntry,
): boolean {
  const view = asRecord(post)
  return (view.enabled === false) !== (seed.enabled === false)
}
