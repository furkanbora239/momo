import type { DialogSelectOption, KeymapCommand } from "@opencode/plugin/tui/context"

import type { NativeCatalogSnapshot } from "../../native-catalog"
import type { NativeModelRef } from "../../native-routing/types"
import { isModelAllowed, toggleModelInPool, type ModelPool } from "../../shared/model-pool"
import { isProviderDisabled, setProviderDisabled, type ProviderToggles } from "../../shared/provider-toggles"
import type { NativeAdvisorPoolControl, NativeCatalogControlStores, NativeCatalogControlView } from "../../native-runtime/tui/catalog-controls"
import type { V2TuiContext } from "./types"

function modelKey(model: NativeModelRef): string {
  return `${model.providerID}/${model.id}`
}

function modelOptions(
  snapshot: NativeCatalogSnapshot,
  pool: ModelPool,
  advisor: readonly NativeModelRef[],
): DialogSelectOption<NativeModelRef>[] {
  return snapshot.models.map((model) => {
    const ref = { providerID: model.providerID, id: model.id }
    const eligibleForAdvisor = advisor.some((item) => modelKey(item) === modelKey(ref))
    const allowed = isModelAllowed(pool, ref.providerID, ref.id)
    const price = model.inputPricePerMillion === undefined || model.outputPricePerMillion === undefined
      ? "price unknown"
      : `in $${model.inputPricePerMillion.toFixed(2)} / out $${model.outputPricePerMillion.toFixed(2)} per M`
    return {
      value: ref,
      title: `${ref.providerID}/${ref.id} · ${allowed ? "allowed" : "excluded"}`,
      description: `${eligibleForAdvisor ? "advisor eligible · " : ""}${price}${model.contextLength === undefined ? "" : ` · ${model.contextLength.toLocaleString()} context`}`,
    }
  })
}

async function chooseModel(
  ctx: V2TuiContext,
  catalog: NativeCatalogControlView,
  stores: NativeCatalogControlStores,
  advisor: NativeAdvisorPoolControl,
  kind: "pool" | "advisor",
): Promise<void> {
  const snapshot = await catalog.refresh()
  const selected = await ctx.ui.dialog.select({
    title: kind === "pool" ? "Model pool" : "Advisor pool",
    placeholder: kind === "pool" ? "Toggle model eligibility" : "Toggle advisor eligibility",
    options: modelOptions(snapshot, stores.readPool(), advisor.read()),
  })
  if (!selected) return

  if (kind === "advisor") {
    const key = modelKey(selected)
    const next = advisor.read().some((item) => modelKey(item) === key)
      ? advisor.read().filter((item) => modelKey(item) !== key)
      : [...advisor.read(), selected]
    await advisor.write(next)
    return chooseModel(ctx, catalog, stores, advisor, kind)
  }

  const current = stores.readPool()
  const next = isModelAllowed(current, selected.providerID, selected.id) && current.allowed.length === 0
    ? {
      version: 1 as const,
      allowed: snapshot.models
        .filter((item) => item.providerID !== selected.providerID || item.id !== selected.id)
        .map((item) => ({ providerID: item.providerID, modelID: item.id })),
      updatedAt: new Date().toISOString(),
    }
    : toggleModelInPool(current, selected.providerID, selected.id)
  stores.writePool(next)
  await chooseModel(ctx, catalog, stores, advisor, kind)
}

async function chooseProvider(
  ctx: V2TuiContext,
  catalog: NativeCatalogControlView,
  stores: NativeCatalogControlStores,
): Promise<void> {
  await catalog.refresh()
  const providerIDs = await catalog.listProviderIDs()
  const toggles = stores.readProviderToggles()
  const options: DialogSelectOption<string>[] = providerIDs.map((providerID) => {
    const disabled = isProviderDisabled(toggles, providerID)
    return {
      value: providerID,
      title: `${providerID} · ${disabled ? "disabled" : "enabled"}`,
      description: "Toggle provider availability for native routing",
    }
  })
  const selected = await ctx.ui.dialog.select({ title: "Providers", placeholder: "Toggle provider availability", options })
  if (!selected) return
  const current = stores.readProviderToggles()
  stores.writeProviderToggles(setProviderDisabled(current, selected, !isProviderDisabled(current, selected)))
  return chooseProvider(ctx, catalog, stores)
}

/** Register the commands in the native TUI setup context. */
export function registerNativeCatalogKeymapControls(
  ctx: V2TuiContext,
  catalog: NativeCatalogControlView,
  stores: NativeCatalogControlStores,
  advisor: NativeAdvisorPoolControl,
): () => void {
  const safely = (label: string, action: () => Promise<void>) => async (): Promise<void> => {
    try {
      await action()
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      ctx.ui.toast.show({
        title: `${label} unavailable`,
        message: detail,
        variant: "error",
      })
    }
  }
  const commands: readonly KeymapCommand[] = [
    { id: "omo.native.pool", title: "Model pool", description: "Choose models available to native routing", group: "Session", palette: true, slash: { name: "pool" }, run: safely("Model pool", () => chooseModel(ctx, catalog, stores, advisor, "pool")) },
    { id: "omo.native.providers", title: "Providers", description: "Enable or disable providers in native routing", group: "Session", palette: true, slash: { name: "providers", aliases: ["provider"] }, run: safely("Providers", () => chooseProvider(ctx, catalog, stores)) },
    { id: "omo.native.advisor-pool", title: "Advisor pool", description: "Choose models allowed for advisor consultations", group: "Session", palette: true, slash: { name: "advisor-pool" }, run: safely("Advisor pool", () => chooseModel(ctx, catalog, stores, advisor, "advisor")) },
  ]
  ctx.keymap.layer(() => ({ mode: "global", commands }))
  return () => undefined
}
