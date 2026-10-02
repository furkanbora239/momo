import { Plugin } from "@opencode/plugin/tui"

import type { SolidRuntime } from "../../features/tui-card"
import { log } from "../../shared/logger"
import { registerBtwSideV2 } from "./btw-side-v2"
import { registerModelPoolV2 } from "./model-pool-v2"
import { registerSidebarV2 } from "./sidebar-v2"
import { loadSolidRuntime, type SolidNode } from "./solid-loader"
import { registerSubagentTreeV2 } from "./subagent-tree-v2"
import { createV2TuiFacade } from "./tui-facade"
import type { V2TuiCleanup, V2TuiContext } from "./types"

export type V2TuiSetupDeps = {
  readonly loadSolid: () => Promise<SolidRuntime<SolidNode> | null>
}

async function runRegistration(
  label: string,
  register: () => void | Promise<void>,
): Promise<void> {
  try {
    await register()
  } catch (error) {
    log(`${label} V2 TUI registration failed`, { error })
  }
}

/**
 * Builds the V2 TUI setup: loads the solid runtime (degrading to a no-op
 * when unavailable), adapts the V2 context onto the momo facade, then
 * registers the flagship TUI features in priority order. Each registration
 * is isolated like the V1 module; the returned cleanup runs every facade
 * cleanup (slot claims, pollers, subscriptions) in registration order.
 */
export function createV2TuiSetup(
  deps: V2TuiSetupDeps = { loadSolid: loadSolidRuntime },
): (ctx: V2TuiContext) => Promise<V2TuiCleanup | void> {
  return async (ctx) => {
    const solid = await deps.loadSolid()
    if (solid === null) {
      return
    }

    const facade = createV2TuiFacade(ctx)

    await runRegistration("[subagent-tree]", () =>
      registerSubagentTreeV2(ctx, facade, solid),
    )
    await runRegistration("[tui-sidebar]", () =>
      registerSidebarV2(ctx, facade, solid),
    )
    await runRegistration("[model-pool]", () =>
      registerModelPoolV2(ctx, facade, solid),
    )
    registerBtwSideV2()

    return () => {
      facade.runCleanups()
    }
  }
}

export default Plugin.define({
  id: "oh-my-openagent:tui",
  setup: createV2TuiSetup(),
})
