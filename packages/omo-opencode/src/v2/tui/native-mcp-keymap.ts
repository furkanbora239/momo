// MODIFIED: persist project MCP preferences through the scoped native server.
import type { KeymapCommand } from "@opencode/plugin/tui/context"
import type { V2TuiContext } from "./types"
import type { McpMode } from "../../native-mcp"

interface McpRow { server: string; mode: McpMode; blockedReason?: string; draining: boolean; startupManaged?: boolean; status: { status: string } }
function rows(value: unknown): McpRow[] {
  if (!value || typeof value !== "object" || !("servers" in value) || !Array.isArray(value.servers)) throw new Error("Invalid MCP policy response")
  return value.servers.map(row => {
    if (!row || typeof row !== "object" || typeof row.server !== "string" || !["off", "on-demand", "always"].includes(row.mode) || typeof row.status?.status !== "string") throw new Error("Invalid MCP policy row")
    return row as McpRow
  })
}

export function registerNativeMcpKeymap(ctx: V2TuiContext): () => void {
  const directory = ctx.location?.directory
  if (!directory) return () => undefined
  const location = { directory }
  async function choose(): Promise<void> {
    const snapshot = await ctx.client.rpc.call({ rpcID: "momo.mcp", method: "snapshot", input: {}, location })
    const selected = await ctx.ui.dialog.select({ title: "Project MCPs", placeholder: "Choose a server", options: rows(snapshot.output).map(row => ({
      value: row.server, title: `${row.server} · ${row.mode}`,
      description: `${row.status.status}${row.draining ? " · finishing active calls" : ""}${row.blockedReason ? ` · ${row.blockedReason}` : ""}${row.startupManaged === false ? " · host startup: run mcp-manage" : ""}`,
    })) })
    if (selected === undefined) return
    const mode = await ctx.ui.dialog.select<McpMode>({ title: selected, placeholder: "Saved for this project across restarts", options: [
      { value: "off", title: "Off", description: "Agents cannot activate this server" },
      { value: "on-demand", title: "On demand", description: "Connect only when an agent requests it" },
      { value: "always", title: "Always", description: "Connect when this project opens" },
    ] })
    if (mode === undefined) return
    await ctx.client.rpc.call({ rpcID: "momo.mcp", method: "setMode", input: { server: selected, mode }, location })
    await choose()
  }
  const command: KeymapCommand = { id: "omo.native.mcps", title: "Project MCPs", description: "Persistent MCP policy for this project", group: "Session", palette: true, slash: { name: "mcp-policy" }, run: async () => {
    try { await choose() }
    catch (error) { ctx.ui.toast.show({ title: "Project MCPs unavailable", message: error instanceof Error ? error.message : String(error), variant: "error" }) }
  } }
  ctx.keymap.layer(() => ({ mode: "global", commands: [command] }))
  return () => undefined
}
