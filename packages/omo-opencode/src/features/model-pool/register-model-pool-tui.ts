import type {
  TuiDialogSelectOption,
  TuiDialogStack,
  TuiPluginApi,
} from "@opencode-ai/plugin/tui"

import { log } from "../../shared/logger"
import {
  isModelAllowed,
  isModelPreferred,
  readModelPool,
  toggleModelInPool,
  writeModelPool,
  type ModelPool,
  type ModelPoolEntry,
} from "../../shared/model-pool"
import {
  isProviderAvailable,
  readProviderHealth,
} from "../../shared/provider-health"
import {
  collectPoolCatalogRows,
  type PoolCatalogRow,
} from "./pool-catalog-rows"

type SolidRuntime<Node> = {
  readonly createElement: (tag: string) => Node
  readonly insert: (
    parent: Node,
    child: unknown,
    marker?: unknown,
    initial?: unknown,
  ) => unknown
  readonly setProp: (
    node: Node,
    name: string,
    value: unknown,
    previous?: unknown,
  ) => unknown
}

type PoolOptionValue =
  | { readonly kind: "model"; readonly providerID: string; readonly modelID: string }
  | { readonly kind: "reset" }

function formatPrice(row: PoolCatalogRow): string {
  if (row.inputPerM === undefined || row.outputPerM === undefined) {
    return "price unknown"
  }
  return `in $${row.inputPerM.toFixed(2)} / out $${row.outputPerM.toFixed(2)} per M`
}

function providerHealthLabel(providerID: string): string {
  if (isProviderAvailable(providerID)) return "healthy"
  const entry = readProviderHealth()[providerID.trim().toLowerCase()]
  return `unhealthy (${entry?.reason ?? "unknown reason"})`
}

function stateLabel(pool: ModelPool, row: PoolCatalogRow): string {
  const allowed = isModelAllowed(pool, row.providerID, row.modelID)
  const preferred = isModelPreferred(pool, row.providerID, row.modelID)
  return [allowed ? "ALLOWED" : "EXCLUDED", preferred ? "PREFERRED" : undefined]
    .filter((part): part is string => part !== undefined)
    .join(" · ")
}

function buildOptions(
  rows: readonly PoolCatalogRow[],
): TuiDialogSelectOption<PoolOptionValue>[] {
  const pool = readModelPool()
  const resetOption: TuiDialogSelectOption<PoolOptionValue> = {
    title: "Clear pool (allow every model)",
    value: { kind: "reset" },
    description: "Removes all entries; an empty pool means no restriction",
    disabled: pool.allowed.length === 0,
  }
  const modelOptions: TuiDialogSelectOption<PoolOptionValue>[] = rows.map(
    (row) => ({
      title: `${row.providerID}/${row.modelID}`,
      value: { kind: "model", providerID: row.providerID, modelID: row.modelID },
      category: row.providerID,
      description: [
        formatPrice(row),
        row.costTier,
        providerHealthLabel(row.providerID),
      ]
        .filter((part): part is string => part !== undefined)
        .join(" · "),
      footer: stateLabel(pool, row),
    }),
  )
  return [resetOption, ...modelOptions]
}

function poolAfterToggle(
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

function handleSelect(
  api: TuiPluginApi,
  dialogStack: TuiDialogStack,
  rows: readonly PoolCatalogRow[],
  option: TuiDialogSelectOption<PoolOptionValue>,
): void {
  const value = option.value
  if (value.kind === "reset") {
    writeModelPool({
      version: 1,
      allowed: [],
      updatedAt: new Date().toISOString(),
    })
    api.ui.toast({
      variant: "info",
      message: "Model pool cleared; every model is allowed again.",
    })
  } else {
    const pool = readModelPool()
    const next = poolAfterToggle(pool, rows, value.providerID, value.modelID)
    writeModelPool(next)
    const allowed = isModelAllowed(next, value.providerID, value.modelID)
    api.ui.toast({
      variant: "info",
      message: `${value.providerID}/${value.modelID} ${allowed ? "allowed" : "excluded"} in the model pool.`,
    })
  }
  dialogStack.replace(renderPoolSelect(api, dialogStack, rows))
  api.renderer.requestRender()
}

function renderPoolSelect(
  api: TuiPluginApi,
  dialogStack: TuiDialogStack,
  rows: readonly PoolCatalogRow[],
) {
  return () =>
    api.ui.DialogSelect<PoolOptionValue>({
      title: "Model pool",
      placeholder: "Filter models",
      options: buildOptions(rows),
      onSelect: (option) => handleSelect(api, dialogStack, rows, option),
    })
}

function openPanel(api: TuiPluginApi, dialogStack: TuiDialogStack): void {
  const rows = collectPoolCatalogRows()
  if (rows === null) {
    api.ui.toast({
      variant: "warning",
      message: "No provider model catalog is available yet.",
    })
    return
  }
  dialogStack.replace(renderPoolSelect(api, dialogStack, rows))
}

/**
 * The `solid` runtime is kept for signature parity with the btw-side TUI
 * wiring; this feature renders exclusively through api.ui dialog components.
 */
export async function registerModelPoolTui<Node>(
  api: TuiPluginApi,
  _solid: SolidRuntime<Node>,
): Promise<void> {
  log("[model-pool] TUI registration started")

  const unregisterSlashCommand =
    api.command?.register(() => [
      {
        title: "Model pool",
        value: "omo.model-pool.slash",
        description: "Pick which models the momo orchestrator may select",
        category: "Session",
        enabled: true,
        slash: {
          name: "pool",
          aliases: ["models-pool"],
        },
        onSelect: (dialog) => openPanel(api, dialog ?? api.ui.dialog),
      },
    ]) ?? (() => undefined)

  api.lifecycle.onDispose(() => {
    unregisterSlashCommand()
  })

  log("[model-pool] TUI controls registered")
}
