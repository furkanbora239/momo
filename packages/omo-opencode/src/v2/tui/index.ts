import { Plugin } from "@opencode/plugin/tui"
import { log } from "../../shared/logger"
import { registerNativeMcpKeymap } from "./native-mcp-keymap"
import { routingProfileCommands } from "./routing-profile-panel"
import { createRoutingStatusPanel } from "./routing-status-panel"
import type { V2TuiCleanup, V2TuiContext } from "./types"

export function createV2TuiSetup(): (ctx: V2TuiContext) => Promise<V2TuiCleanup> {
  return async (ctx) => {
    let cleanup: V2TuiCleanup = () => undefined
    try { cleanup = registerNativeMcpKeymap(ctx) }
    catch (error) { log("[native-mcp-controls] V2 TUI registration failed", { error: String(error) }) }

    const panel = createRoutingStatusPanel(ctx)
    try {
      const commands = routingProfileCommands(ctx, panel)
      if (commands.length) ctx.keymap.layer(() => ({ mode: "global", commands }))
    } catch (error) {
      log("[native-routing-controls] V2 TUI registration failed", { error: String(error) })
    }
    return () => { panel.dispose(); return cleanup() }
  }
}

export default Plugin.define({ id: "oh-my-openagent:tui", setup: createV2TuiSetup() })
