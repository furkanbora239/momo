import type { NativeCatalogSnapshot } from "../../native-catalog"
import type { NativeModelRef } from "../../native-routing/types"
import type { ModelPool } from "../../shared/model-pool"
import { isModelAllowed, toggleModelInPool } from "../../shared/model-pool"
import type { ProviderToggles } from "../../shared/provider-toggles"
import { isProviderDisabled, setProviderDisabled } from "../../shared/provider-toggles"
import type { SolidRuntime } from "../../features/tui-card"
import type { CardDescriptor } from "../../features/tui-card"
import type { CardDialogV2 } from "../../v2/tui/card-dialog-v2"
import { createCardDialogV2 } from "../../v2/tui/card-dialog-v2"
import type { SolidNode } from "../../v2/tui/solid-loader"
import type { V2TuiFacade } from "../../v2/tui/tui-facade"

export type NativeAdvisorPoolControl = {
  read(): readonly NativeModelRef[]
  write(models: readonly NativeModelRef[]): Promise<void> | void
}

export type NativeCatalogControlView = {
  refresh(): Promise<NativeCatalogSnapshot>
  snapshot(): NativeCatalogSnapshot
  listProviderIDs(): Promise<readonly string[]>
}

export type NativeCatalogControlStores = {
  readPool(): ModelPool
  writePool(pool: ModelPool): void
  readProviderToggles(): ProviderToggles
  writeProviderToggles(toggles: ProviderToggles): void
}

type NativeModelCard = CardDescriptor & { providerID: string; modelID: string }
type NativeProviderCard = CardDescriptor & { providerID: string; disabled: boolean }

const normalizeModelRef = (providerID: string, id: string): string => `${providerID}/${id}`

export function nativeAdvisorPoolAfterToggle(
  models: readonly NativeModelRef[],
  model: NativeModelRef,
): readonly NativeModelRef[] {
  const key = normalizeModelRef(model.providerID, model.id)
  return models.some((item) => normalizeModelRef(item.providerID, item.id) === key)
    ? models.filter((item) => normalizeModelRef(item.providerID, item.id) !== key)
    : [...models, model]
}

export function nativePoolModelCards(
  models: readonly (NativeModelRef & { readonly inputPricePerMillion?: number; readonly outputPricePerMillion?: number; readonly contextLength?: number })[],
  pool: ModelPool,
  advisorPool: readonly NativeModelRef[],
): NativeModelCard[] {
  return models.map((model) => {
    const allowed = isModelAllowed(pool, model.providerID, model.id)
    const advisor = advisorPool.some((item) => normalizeModelRef(item.providerID, item.id) === normalizeModelRef(model.providerID, model.id))
    return {
      id: normalizeModelRef(model.providerID, model.id),
      providerID: model.providerID,
      modelID: model.id,
      title: model.id,
      badge: { text: allowed ? "ALLOWED" : "EXCLUDED", tone: allowed ? "positive" : "negative" },
      bodyLines: [
        advisor ? "advisor eligible" : "general pool only",
        model.inputPricePerMillion === undefined || model.outputPricePerMillion === undefined
          ? "price unknown"
          : `in $${model.inputPricePerMillion.toFixed(2)} / out $${model.outputPricePerMillion.toFixed(2)} per M`,
        ...(model.contextLength === undefined ? [] : [`${model.contextLength.toLocaleString()} context`]),
      ],
      indent: 0,
    }
  })
}

export function nativeProviderCards(
  providers: readonly string[],
  toggles: ProviderToggles,
): NativeProviderCard[] {
  return providers.map((providerID) => {
    const disabled = isProviderDisabled(toggles, providerID)
    return {
      id: providerID,
      providerID,
      disabled,
      title: providerID,
      badge: { text: disabled ? "DISABLED" : "ENABLED", tone: disabled ? "negative" : "positive" },
      bodyLines: [disabled ? "excluded from native model catalog" : "available to native model catalog"],
      indent: 0,
    }
  })
}

export function registerNativeCatalogControls(
  facade: V2TuiFacade,
  solid: SolidRuntime<SolidNode>,
  catalog: NativeCatalogControlView,
  stores: NativeCatalogControlStores,
  advisor: NativeAdvisorPoolControl,
): void {
  let modelDialog: CardDialogV2<NativeModelCard>
  modelDialog = createCardDialogV2<SolidNode, NativeModelCard>({
    solid, facade, mode: "omo.native-tui.model-pool", title: "Model pool",
    hint: () => "up/down or j/k move - Enter toggle model - Esc closes",
    footerHint: () => "Models are read from the live OpenCode provider/model catalog",
    ghostLine: () => modelDialog.visibleCount() === 0 ? "no connected models" : undefined,
    filterTexts: (card) => [normalizeModelRef(card.providerID, card.modelID)],
    onActivate: async (card) => {
      const current = stores.readPool()
      const next = isModelAllowed(current, card.providerID, card.modelID) && current.allowed.length === 0
        ? { version: 1 as const, allowed: catalog.snapshot().models
          .filter((item) => item.providerID !== card.providerID || item.id !== card.modelID)
          .map((item) => ({ providerID: item.providerID, modelID: item.id })), updatedAt: new Date().toISOString() }
        : toggleModelInPool(current, card.providerID, card.modelID)
      stores.writePool(next)
      await catalog.refresh()
      modelDialog.restyleAll(nativePoolModelCards(catalog.snapshot().models, next, advisor.read()))
      facade.requestRender()
    },
  })
  let providerDialog: CardDialogV2<NativeProviderCard>
  providerDialog = createCardDialogV2<SolidNode, NativeProviderCard>({
    solid, facade, mode: "omo.native-tui.providers", title: "Providers",
    hint: () => "up/down or j/k move - Enter toggle provider - Esc closes",
    footerHint: () => "Changes are re-read by the next routing/catalog snapshot",
    ghostLine: () => providerDialog.visibleCount() === 0 ? "no providers" : undefined,
    filterTexts: (card) => [card.providerID],
    onActivate: async (card) => {
      const next = setProviderDisabled(stores.readProviderToggles(), card.providerID, !card.disabled)
      stores.writeProviderToggles(next)
      const snapshot = await catalog.refresh()
      const providers = await catalog.listProviderIDs()
      providerDialog.restyleAll(nativeProviderCards(providers, next))
      if (snapshot.connectedProviders.length === 0) facade.toast({ variant: "info", message: "No connected providers are available." })
      facade.requestRender()
    },
  })
  let advisorDialog: CardDialogV2<NativeModelCard>
  advisorDialog = createCardDialogV2<SolidNode, NativeModelCard>({
    solid, facade, mode: "omo.native-tui.advisor-pool", title: "Advisor pool",
    hint: () => "up/down or j/k move - Enter toggle advisor model - Esc closes",
    footerHint: () => "Advisor models are intersected with the general model pool",
    ghostLine: () => advisorDialog.visibleCount() === 0 ? "no connected models" : undefined,
    filterTexts: (card) => [normalizeModelRef(card.providerID, card.modelID)],
    onActivate: async (card) => {
      await advisor.write(nativeAdvisorPoolAfterToggle(advisor.read(), { providerID: card.providerID, id: card.modelID }))
      modelDialog.restyleAll(nativePoolModelCards(catalog.snapshot().models, stores.readPool(), advisor.read()))
      advisorDialog.restyleAll(nativePoolModelCards(catalog.snapshot().models, stores.readPool(), advisor.read()))
      facade.requestRender()
    },
  })

  const openModels = async (kind: "pool" | "advisor"): Promise<void> => {
    try {
      await catalog.refresh()
      const cards = nativePoolModelCards(catalog.snapshot().models, stores.readPool(), advisor.read())
      if (kind === "pool") modelDialog.open(cards)
      else advisorDialog.open(cards)
    } catch (error) {
      facade.toast({ variant: "warning", message: `Could not refresh the native model catalog: ${error instanceof Error ? error.message : String(error)}` })
    }
  }
  const openProviders = async (): Promise<void> => {
    try {
      const snapshot = await catalog.refresh()
      const providers = await catalog.listProviderIDs()
      providerDialog.open(nativeProviderCards(providers, stores.readProviderToggles()))
      if (snapshot.connectedProviders.length === 0) facade.toast({ variant: "info", message: "No connected providers are available." })
    } catch (error) {
      facade.toast({ variant: "warning", message: `Could not refresh providers: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  facade.addKeymapLayer(() => ({
    mode: "global",
    commands: [
      { id: "omo.native.pool", title: "Model pool", description: "Choose models available to native routing", group: "Session", palette: true, slash: { name: "pool" }, run: () => void openModels("pool") },
      { id: "omo.native.providers", title: "Providers", description: "Enable or disable providers in native routing", group: "Session", palette: true, slash: { name: "providers", aliases: ["provider"] }, run: () => void openProviders() },
      { id: "omo.native.advisor-pool", title: "Advisor pool", description: "Choose models allowed for advisor consultations", group: "Session", palette: true, slash: { name: "advisor-pool" }, run: () => void openModels("advisor") },
    ],
  }), solid)
  facade.onCleanup(() => {
    for (const dialog of [modelDialog, providerDialog, advisorDialog]) if (dialog.isOpen()) dialog.suspend()
  })
}
