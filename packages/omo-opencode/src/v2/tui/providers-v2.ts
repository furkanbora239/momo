import { homedir } from "node:os"
import { join } from "node:path"

import { log } from "../../shared/logger"
import { readProviderModelsCache } from "../../shared/connected-providers-cache"
import { readProviderHealth } from "../../shared/provider-health"
import {
  createProviderTogglesStore,
  isProviderDisabled,
  setProviderDisabled,
  type ProviderToggles,
} from "../../shared/provider-toggles"
import {
  buildProviderCards,
  providerFilterTexts,
  providerHealthNote,
  type ProviderCard,
} from "../../features/providers/provider-cards"
import type { SolidRuntime } from "../../features/tui-card"
import { createCardDialogV2, type CardDialogV2 } from "./card-dialog-v2"
import type { SolidNode } from "./solid-loader"
import type { V2TuiContext } from "./types"
import type { V2TuiFacade } from "./tui-facade"

const CARD_MODE = "omo.tui-card.providers"

// Resolve the toggles file relative to $HOME so tests (and real usage) that
// isolate HOME get a self-contained path, mirroring the /pool panel store.
const togglesStore = createProviderTogglesStore(() =>
  join(process.env.HOME ?? homedir(), ".omo", "provider-toggles.json"),
)

function healthNoteFor(providerID: string): string | undefined {
  return providerHealthNote(readProviderHealth(), providerID, Date.now())
}

function buildCards(): ProviderCard[] {
  const toggles: ProviderToggles = togglesStore.readProviderToggles()
  return buildProviderCards({
    toggles,
    cache: readProviderModelsCache(),
    healthNote: healthNoteFor,
  })
}

function providersHint(): string {
  return "up/down or j/k move - Enter toggles - Esc clears filter then closes"
}

type ProviderPanelState = {
  cards: readonly ProviderCard[]
}

/**
 * V2 port of the /providers panel: the V1 dialog stack, mode push, card
 * keymap, toasts, and slash command map onto the V2 dialog, keymap.mode,
 * keymap layer commands, and ui.toast.show through the shared card dialog.
 */
export function registerProvidersV2(
  ctx: V2TuiContext,
  facade: V2TuiFacade,
  solid: SolidRuntime<SolidNode>,
): void {
  log("[providers] V2 TUI registration started")

  const state: ProviderPanelState = { cards: [] }

  const controller: CardDialogV2<ProviderCard> = createCardDialogV2<SolidNode, ProviderCard>({
    solid,
    facade,
    mode: CARD_MODE,
    title: "Providers",
    hint: providersHint,
    footerHint: () => undefined,
    ghostLine: () => (controller.visibleCount() === 0 ? "no providers yet" : undefined),
    filterTexts: providerFilterTexts,
    onActivate: activateCard,
  })

  function openDialog(): void {
    if (controller.isOpen()) {
      controller.close()
    }
    state.cards = buildCards()
    if (state.cards.length === 0) {
      facade.toast({
        variant: "info",
        message: "No connected providers yet.",
      })
      return
    }
    controller.open(state.cards)
  }

  function activateCard(card: ProviderCard): void {
    const toggles = togglesStore.readProviderToggles()
    const disabled = isProviderDisabled(toggles, card.providerID)
    const next = setProviderDisabled(toggles, card.providerID, !disabled)
    togglesStore.writeProviderToggles(next)
    facade.toast({
      variant: "info",
      message: `provider ${card.providerID} ${disabled ? "enabled" : "disabled"}`,
    })
    controller.restyleAll(buildCards())
    facade.requestRender()
  }

  facade.addKeymapLayer(() => ({
    commands: [
      {
        id: "omo.providers.slash",
        title: "Providers",
        description: "Enable or disable providers for the catalog and delegation",
        group: "Session",
        palette: true,
        slash: { name: "providers", aliases: ["provider", "provider-toggles"] },
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

  log("[providers] V2 TUI controls registered")
}
