import type { Command } from "commander"
import { adoptConfiguredNativeMcps } from "../native-mcp/configuration"

export function configureMcpCommand(program: Command): void {
  program.command("mcp-manage")
    .description("Manage native MCP startup through momo project policy; preserves native definitions and a private backup")
    .option("--config <path>", "Native OpenCode configuration to adopt")
    .action(async (options: { config?: string }) => {
      const result = await adoptConfiguredNativeMcps(options.config)
      console.log(result.servers.length ? `Momo now manages ${result.servers.length} MCP server(s). Private backup: ${result.backupPath}. Restart OpenCode to apply startup control.` : "No unmanaged native MCP servers found.")
    })
}
