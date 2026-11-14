// MODIFIED: momo native project-scoped MCP availability policy.
export type McpMode = "off" | "on-demand" | "always"
export type McpPolicy = Readonly<Record<string, McpMode>>

export function isMcpMode(value: unknown): value is McpMode {
  return value === "off" || value === "on-demand" || value === "always"
}

export function assertMcpServerName(server: string): void {
  if (!server || server.trim() !== server || /[\u0000-\u001f\u007f]/.test(server) ||
      ["__proto__", "constructor", "prototype"].includes(server)) {
    throw new Error("Invalid MCP server name")
  }
}

export function resolveMcpPolicy(input: {
  readonly server: string
  readonly modes?: McpPolicy
  readonly disabledMcps?: readonly string[]
  readonly upstreamDisabled?: boolean
}): { mode: McpMode; blockedReason?: "disabled_mcp" | "upstream_disabled" | "policy_off" } {
  if (input.disabledMcps?.includes(input.server)) return { mode: "off", blockedReason: "disabled_mcp" }
  if (input.upstreamDisabled) return { mode: "off", blockedReason: "upstream_disabled" }
  const explicit = input.modes && Object.hasOwn(input.modes, input.server) ? input.modes[input.server] : undefined
  const mode = explicit ?? (["momo_lsp", "momo_ast_grep"].includes(input.server) ? "always" :
    ["codegraph", "codebase-memory-mcp"].includes(input.server) ? "off" : "on-demand")
  return mode === "off" ? { mode, blockedReason: "policy_off" } : { mode }
}
