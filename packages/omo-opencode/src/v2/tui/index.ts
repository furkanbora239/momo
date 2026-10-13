import { Plugin } from "@opencode/plugin/tui"

import { log } from "../../shared/logger"
import type { V2TuiCleanup, V2TuiContext } from "./types"
import type { NativeCatalogAdapter } from "../../native-catalog"
import type { NativeCatalogSnapshot } from "../../native-catalog"
import type { NativeAdvisorPoolControl } from "../../native-runtime/tui/catalog-controls"
import { createNativeCatalogControlStores } from "../../native-runtime/tui/control-stores"
import { resolveNativeHomeDirectory } from "../../native-catalog/paths"
import { registerNativeCatalogKeymapControls } from "./native-catalog-keymap"
import { loadNativeTaskSidebar } from "./native-task-sidebar"
import { getAdvisorPool } from "../../native-runtime/advisor-pool-config"

type NativeCatalogView = Pick<NativeCatalogAdapter, "refresh" | "snapshot" | "listProviderIDs">

function isNativeCatalogSnapshot(value: unknown): value is NativeCatalogSnapshot {
  if (!value || typeof value !== "object") return false
  const snapshot = value as Record<string, unknown>
  return typeof snapshot.fetchedAt === "string" && Array.isArray(snapshot.connectedProviders) &&
    Array.isArray(snapshot.models) && typeof snapshot.sources === "object" && snapshot.sources !== null &&
    typeof snapshot.transportModelIDs === "object" && snapshot.transportModelIDs !== null &&
    typeof snapshot.unregisteredLiveModels === "object" && snapshot.unregisteredLiveModels !== null &&
    typeof snapshot.unavailableProviders === "object" && snapshot.unavailableProviders !== null
}

function createRpcCatalogView(ctx: V2TuiContext, directory: string): NativeCatalogView {
  let snapshot: NativeCatalogSnapshot = {
    fetchedAt: "", connectedProviders: [], models: [], sources: {}, transportModelIDs: {},
    unregisteredLiveModels: {}, unavailableProviders: {},
  }
  let providerIDs: readonly string[] = []
  return {
    async refresh() {
      const response = await ctx.client.rpc.call({
        rpcID: "momo.native", method: "catalogSnapshot", location: { directory }, input: {},
      })
      const output: unknown = response.output
      if (!output || typeof output !== "object") throw new Error("native catalog RPC returned an invalid result")
      const result = output as Record<string, unknown>
      if (!isNativeCatalogSnapshot(result.snapshot) || !Array.isArray(result.providerIDs) ||
          !result.providerIDs.every((providerID) => typeof providerID === "string")) {
        throw new Error("native catalog RPC returned an invalid snapshot")
      }
      snapshot = result.snapshot
      providerIDs = result.providerIDs
      return snapshot
    },
    snapshot: () => snapshot,
    listProviderIDs: async () => [...providerIDs],
  }
}

export type V2TuiSetupDeps = {
  readonly registerTaskSidebar?: (ctx: V2TuiContext) => Promise<() => void>
  readonly getCatalog?: (ctx: V2TuiContext) => NativeCatalogView | undefined
  readonly getAdvisorPool?: (ctx: V2TuiContext) => NativeAdvisorPoolControl | undefined
  readonly homeDirectory?: (ctx: V2TuiContext) => string
}

async function runRegistration(
  label: string,
  register: () => void | Promise<void>,
): Promise<void> {
  try {
    await register()
  } catch (error) {
    log(`${label} V2 TUI registration failed`, {
      error:
        error instanceof Error
          ? `${error.message}\n${error.stack ?? ""}`
          : String(error),
    })
  }
}

/**
 * Registers catalog controls through OpenCode's native keymap context. The
 * TUI process reads the server-owned catalog over the scoped native RPC and
 * writes the shared model/provider stores plus project advisor configuration.
 */
export function createV2TuiSetup(
  deps: V2TuiSetupDeps = {
    getCatalog: (ctx) => createRpcCatalogView(ctx, ctx.location?.directory ?? ""),
    getAdvisorPool: (ctx) => getAdvisorPool(ctx.location?.directory ?? ""),
      homeDirectory: () => resolveNativeHomeDirectory(),
  },
): (ctx: V2TuiContext) => Promise<V2TuiCleanup | void> {
  return async (ctx) => {
    const cleanups: (() => void)[] = []

    await runRegistration("[native-catalog-controls]", () => {
      const directory = ctx.location?.directory ?? ""
      const catalog = deps.getCatalog?.(ctx) ?? createRpcCatalogView(ctx, directory)
      const advisorPool = deps.getAdvisorPool?.(ctx) ?? getAdvisorPool(directory)
      if (!catalog || !advisorPool) {
        log("[native-catalog-controls] shared native catalog or advisor config is not ready")
        return
      }
      const stores = createNativeCatalogControlStores(deps.homeDirectory?.(ctx))
      cleanups.push(registerNativeCatalogKeymapControls(ctx, catalog, stores, advisorPool))
    })

    await runRegistration("[native-task-sidebar]", async () => {
      cleanups.push(await (deps.registerTaskSidebar ?? loadNativeTaskSidebar)(ctx))
    })

    return () => {
      for (const cleanup of cleanups.splice(0)) cleanup()
    }
  }
}

export default Plugin.define({
  id: "oh-my-openagent:tui",
  setup: createV2TuiSetup(),
})
