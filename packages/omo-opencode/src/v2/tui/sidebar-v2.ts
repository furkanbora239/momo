import { readFileSync } from "node:fs"
import { log } from "../../shared/logger"
import { loadOmoConfig } from "@oh-my-opencode/omo-config-core"
import type { SolidRuntime } from "../../features/tui-card"
import {
  computeView,
  viewKey,
} from "../../features/tui-sidebar/compute-view"
import {
  deriveAgents,
  deriveConfig,
  deriveJobBoard,
  deriveLoop,
  deriveRoster,
} from "../../features/tui-sidebar/derivers"
import { readMirror } from "../../features/tui-sidebar/mirror-io"
import { buildViewNodes } from "../../features/tui-sidebar/render-view"
import type { RosterRow, SidebarView } from "../../features/tui-sidebar/state-types"
import { POLL_INTERVAL_MS } from "../../features/tui-sidebar/constants"
import { materializeViewNodes } from "./view-materializer"
import { createViewPoller } from "./view-poller"
import type { SolidNode } from "./solid-loader"
import type { V2TuiContext } from "./types"
import type { V2TuiFacade } from "./tui-facade"

type PluginValidation = {
  readonly valid: boolean
  readonly messages: readonly string[]
  readonly config: {
    readonly tui?: {
      readonly sidebar?: {
        readonly enabled?: boolean
        readonly roster?: boolean
      }
    }
  }
}

async function loadPluginValidation(directory: string): Promise<PluginValidation> {
  const { validatePluginConfig } = await import("../../config/validate")
  return validatePluginConfig(directory)
}

/**
 * Reads the project config file directly to recover `tui.sidebar.enabled`.
 * `validatePluginConfig` parses each layer with the strict `OmoConfigLayerSchema`,
 * which does not include `tui`, so the key is dropped before it reaches the
 * merged config (the merged config always falls back to the schema default of
 * `enabled: true`). Reading the raw project layer preserves the user's intent.
 */
function isSidebarDisabled(directory: string): boolean {
  try {
    const loaded = loadOmoConfig({ cwd: directory })
    for (const source of loaded.sources) {
      if (source.scope !== "project" || !source.exists) continue
      const raw = JSON.parse(readFileSync(source.path, "utf-8")) as {
        tui?: { sidebar?: { enabled?: boolean } }
      }
      if (raw?.tui?.sidebar?.enabled === false) return true
    }
  } catch {
    // unreadable or malformed project config: fail open (sidebar enabled)
  }
  return false
}

async function loadRosterRows(
  directory: string,
  enabled: boolean,
): Promise<readonly RosterRow[]> {
  if (!enabled) return []
  const { resolveRoster } = await import("../../features/tui-sidebar/roster-resolver")
  return resolveRoster(directory)
}

async function readSidebarView(directory: string): Promise<SidebarView> {
  const validation = await loadPluginValidation(directory)
  const mirror = readMirror(directory)
  const roster = await loadRosterRows(
    directory,
    validation.config.tui?.sidebar?.roster === true,
  )
  return computeView({
    config: deriveConfig(validation),
    roster: deriveRoster(roster),
    agents: deriveAgents(mirror),
    jobs: deriveJobBoard(mirror),
    loop: deriveLoop(mirror),
  })
}

/**
 * V2 port of the V1 sidebar_content slot: the V1 api.slots.register
 * ({order: 900, slots: {sidebar_content}}) maps to a ui.slot claim appended
 * to "sidebar.content"; the V1 poll loop maps to the view poller; the V1
 * api.lifecycle.onDispose cleanup maps to the facade cleanup registry. The
 * tui.sidebar.enabled config gate is preserved by reading the project config
 * layer directly (momo config lives in omo.jsonc, not V2 plugin options).
 */
export async function registerSidebarV2(
  ctx: V2TuiContext,
  facade: V2TuiFacade,
  solid: SolidRuntime<SolidNode>,
): Promise<void> {
  const directory = facade.directory()
  if (directory === undefined) {
    log("[tui-sidebar] V2 TUI location unavailable; sidebar skipped")
    return
  }
  if (isSidebarDisabled(directory)) {
    return
  }

  let currentView = await readSidebarView(directory)

  const unregisterSlot = ctx.ui.slot({
    append: "sidebar.content",
    render: () => materializeViewNodes(buildViewNodes(currentView, facade.theme()), solid),
  })
  facade.requestRender()

  const poller = createViewPoller<SidebarView>({
    directory,
    intervalMs: POLL_INTERVAL_MS,
    initialKey: viewKey(currentView),
    readView: readSidebarView,
    viewKeyOf: viewKey,
    onViewChanged: (view) => {
      currentView = view
      facade.requestRender()
    },
    onError: (error) => {
      log("[tui-sidebar] V2 polling failed", { error })
    },
  })
  poller.start()

  facade.onCleanup(() => {
    poller.dispose()
    unregisterSlot()
  })
}
