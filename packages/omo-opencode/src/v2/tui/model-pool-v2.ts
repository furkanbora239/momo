import { homedir } from "node:os"
import { join } from "node:path"
import { log } from "../../shared/logger"
import type { SolidRuntime } from "../../features/tui-card"
import {
  collectPoolCatalogRows,
  type PoolCatalogRow,
} from "../../features/model-pool/pool-catalog-rows"
import {
  buildPoolCards,
  groupPoolCards,
  poolFilterTexts,
  poolProviderHealthNote,
  type PoolCard,
} from "../../features/model-pool/pool-cards"
import {
  createModelPoolStore,
  isModelAllowed,
  toggleModelInPool,
  type ModelPool,
  type ModelPoolEntry,
} from "../../shared/model-pool"
import { readProviderHealth } from "../../shared/provider-health"
import { createCardDialogV2, type CardDialogV2 } from "./card-dialog-v2"
import type { SolidNode } from "./solid-loader"
import type { V2TuiContext } from "./types"
import type { V2TuiFacade } from "./tui-facade"

const CARD_MODE = "omo.tui-card.pool"
const CLEAR_KEY = "alt+c"

// Resolve the pool file relative to $HOME so tests (and real usage) that
// isolate HOME get a self-contained path. The default store uses os.homedir(),
// which ignores $HOME, so we supply an explicit resolver here.
const poolStore = createModelPoolStore(() =>
  join(process.env.HOME ?? homedir(), ".omo", "model-pool.json"),
)

export function poolAfterToggle(
  pool: ModelPool,
  rows: readonly PoolCatalogRow[],
  providerID: string,
  modelID: string,
): ModelPool {
  if (!isModelAllowed(pool, providerID, modelID)) {
    return toggleModelInPool(pool, providerID, modelID)
  }
  if (pool.allowed.length === 0) {
    // An empty pool allows everything; excluding one model requires
    // materializing the full catalog minus that entry so every other
    // model keeps its allowed state.
    const allowed: ModelPoolEntry[] = rows
      .filter((row) => row.providerID !== providerID || row.modelID !== modelID)
      .map((row) => ({ providerID: row.providerID, modelID: row.modelID }))
    return { version: 1, allowed, updatedAt: new Date().toISOString() }
  }
  return toggleModelInPool(pool, providerID, modelID)
}

function healthNoteFor(providerID: string): string | undefined {
  return poolProviderHealthNote(readProviderHealth(), providerID, Date.now())
}

function buildCards(rows: readonly PoolCatalogRow[]): PoolCard[] {
  return buildPoolCards({ pool: poolStore.readModelPool(), rows, healthNote: healthNoteFor })
}

function poolHint(): string {
  return "up/down or j/k move - Enter toggle - Esc clears filter then closes"
}

function poolFooterHint(): string {
  return "alt+c clear pool (allow every model)"
}

type ModelPoolState = {
  rows: readonly PoolCatalogRow[]
}

/**
 * V2 port of the /pool model pool panel: the V1 dialog stack, mode push,
 * card keymap (with the alt+c clear binding), toasts, and slash command map
 * onto the V2 dialog, keymap.mode, keymap layer commands, ui.toast.show,
 * and a palette + slash keymap command.
 */
export function registerModelPoolV2(
  ctx: V2TuiContext,
  facade: V2TuiFacade,
  solid: SolidRuntime<SolidNode>,
): void {
  log("[model-pool] V2 TUI registration started")

  const state: ModelPoolState = { rows: [] }

  const controller: CardDialogV2<PoolCard> = createCardDialogV2<SolidNode, PoolCard>({
    solid,
    facade,
    mode: CARD_MODE,
    title: "Model pool",
    hint: poolHint,
    footerHint: poolFooterHint,
    ghostLine: () =>
      controller.visibleCount() === 0 ? "no models match the filter" : undefined,
    filterTexts: poolFilterTexts,
    onActivate: activateCard,
    extraBindings: [{ key: CLEAR_KEY, run: clearPool }],
  })

  function openDialog(): void {
    if (controller.isOpen()) {
      controller.close()
    }
    const rows = collectPoolCatalogRows()
    if (rows === null) {
      facade.toast({
        variant: "warning",
        message: "No provider model catalog is available yet.",
      })
      return
    }
    state.rows = rows
    controller.open(buildCards(rows))
  }

  function activateCard(card: PoolCard): void {
    const pool = poolStore.readModelPool()
    const next = poolAfterToggle(pool, state.rows, card.providerID, card.modelID)
    poolStore.writeModelPool(next)
    const allowed = isModelAllowed(next, card.providerID, card.modelID)
    facade.toast({
      variant: "info",
      message: `${card.providerID}/${card.modelID} ${allowed ? "allowed" : "excluded"} in the model pool.`,
    })
    controller.restyleAll(buildCards(state.rows))
    facade.requestRender()
  }

  function clearPool(): void {
    if (!controller.isOpen()) return
    poolStore.writeModelPool({
      version: 1,
      allowed: [],
      updatedAt: new Date().toISOString(),
    })
    facade.toast({
      variant: "info",
      message: "Model pool cleared; every model is allowed again.",
    })
    controller.restyleAll(buildCards(state.rows))
    facade.requestRender()
  }

  facade.addKeymapLayer(() => ({
    commands: [
      {
        id: "omo.model-pool.pool",
        title: "Model pool",
        description: "Pick which models the momo orchestrator may select",
        group: "Session",
        palette: true,
        slash: { name: "pool", aliases: ["models-pool"] },
        run: () => openDialog(),
      },
    ],
    mode: "global",
  }), solid)

  facade.onCleanup(() => {
    if (controller.isOpen()) {
      controller.suspend()
    }
  })

  log("[model-pool] V2 TUI controls registered")
}
