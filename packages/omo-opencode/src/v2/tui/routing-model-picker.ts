import type { DialogSelectOption } from "@opencode/plugin/tui/context"
import type { RoutingStatus } from "../../native-runtime/routing-profile-rpc"
import type { NativeModelRef } from "../../native-routing/types"
import type { V2TuiContext } from "./types"

type ModelRow = RoutingStatus["models"][number]
export const modelLabel = (model: NativeModelRef): string => `${model.providerID}/${model.id}`
export const chatReady = (row: ModelRow): boolean => row.available && (row.type === undefined || row.type === "chat")
export const workerReady = (row: ModelRow): boolean => chatReady(row) && row.toolCall !== false
export const asModelRef = (model: NativeModelRef): NativeModelRef => ({ id: model.id, providerID: model.providerID })

export function modelIssue(status: RoutingStatus, ref: NativeModelRef, accept = chatReady): string | undefined {
  const model = status.models.find(row => modelLabel(row) === modelLabel(ref))
  if (model && accept(model)) return
  return model?.reason ?? status.providers.find(row => row.id === ref.providerID)?.reason ?? "Unavailable for this role"
}

function modelOption(row: ModelRow): DialogSelectOption<string> {
  const price = row.inputPricePerMillion === undefined || row.outputPricePerMillion === undefined ? "Price unverified"
    : row.inputPricePerMillion === 0 && row.outputPricePerMillion === 0 ? "Verified free" : `Published $ ${row.inputPricePerMillion} in / $ ${row.outputPricePerMillion} out per 1M`
  return { title: row.displayName ?? row.id, value: modelLabel(row), category: row.providerID, description: `${row.id} · ${price}` }
}

export async function pickRoutingModel(ctx: V2TuiContext, title: string, rows: ModelRow[], current?: NativeModelRef) {
  const options = [...rows].sort((a, b) => modelLabel(a).localeCompare(modelLabel(b))).map(modelOption)
  if (options.length === 0) {
    await ctx.ui.dialog.alert({ title, message: "Connect a provider with an available model for this role." })
    return
  }
  const chosen = await ctx.ui.dialog.select({ title, options, current: current && modelLabel(current) })
  const model = rows.find(row => modelLabel(row) === chosen)
  return model && asModelRef(model)
}

export async function pickRoutingModels(
  ctx: V2TuiContext, title: string, status: RoutingStatus, initial: readonly NativeModelRef[],
): Promise<NativeModelRef[] | undefined> {
  const selected = new Map(initial.map(item => [modelLabel(item), asModelRef(item)]))
  const [selection, updateSelection] = ctx.storage.memory("routing-model-picker", { initial: { checked: [...selected.keys()] } })
  updateSelection(draft => { draft.checked = [...selected.keys()] })
  const models = new Map(status.models.filter(workerReady).map(item => [modelLabel(item), asModelRef(item)]))
  const options = [...status.models.filter(workerReady)].sort((a, b) => modelLabel(a).localeCompare(modelLabel(b))).map(modelOption)
  for (const model of initial) {
    const id = modelLabel(model)
    if (!models.has(id)) options.push({ title: model.id, value: id, category: model.providerID, description: modelIssue(status, model, workerReady) })
  }
  if (!options.length) {
    await ctx.ui.dialog.alert({ title, message: "Connect a provider with a tool-capable chat model." })
    return
  }
  let done = false
  function toggle(id: string) {
    const model = models.get(id)
    if (selected.has(id)) selected.delete(id)
    else if (model) selected.set(id, model)
    else return
    updateSelection(draft => { draft.checked = [...selected.keys()] })
    ctx.ui.toast.show({ variant: "info", title: `${selected.size} models selected`, message: `${id} ${selected.has(id) ? "added to draft" : "removed from draft"}` })
  }
  let focused: string | undefined
  for (;;) {
    const result: string | undefined = await ctx.ui.dialog.select({
      title,
      placeholder: "Search models · Ctrl+Space toggle · Ctrl+S keep draft",
      current: focused,
      get options() {
        const checked = new Set(selection.checked)
        return options.map(row => ({ ...row, title: `${checked.has(row.value) ? "[x]" : "[ ]"} ${row.title}` }))
      },
      actions: [
        { bind: "ctrl+space", title: "Toggle", onTrigger: toggle },
        { bind: "ctrl+s", title: "Keep draft", selection: "none", onTrigger: () => { done = true; ctx.ui.dialog.clear() } },
      ],
    })
    if (done) return [...selected.values()]
    if (result === undefined) return
    focused = result
    toggle(result)
    if (await ctx.ui.dialog.confirm({ title: "Keep model selections?", message: `${selected.size} selected. Continue to edit more models, or keep this draft.`, label: { confirm: "Keep draft", cancel: "Continue editing" } })) return [...selected.values()]
  }
}
