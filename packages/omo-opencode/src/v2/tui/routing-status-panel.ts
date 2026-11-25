import type { RoutingStatus } from "../../native-runtime/routing-profile-rpc"
import { createBoxNode, createTextNode } from "../../features/tui-card"
import { modelIssue, modelLabel, workerReady } from "./routing-model-picker"
import { loadSolidRuntime } from "./solid-loader"
import type { V2TuiContext } from "./types"

const panelName = "momo.routing"

function themeColor(token: unknown, variant = "base"): string | undefined {
  if (typeof token === "string") return token
  if (token && typeof token === "object") {
    const color: unknown = Reflect.get(token, variant)
    if (typeof color === "string") return color
  }
}

export function createRoutingStatusPanel(ctx: V2TuiContext) {
  let status: RoutingStatus | undefined
  let unregister: (() => void) | undefined

  async function show(next: RoutingStatus) {
    if (!ctx.ui.panel || ctx.ui.router.current().type !== "session") {
      await ctx.ui.dialog.alert({ title: "Routing status", message: "Open an OpenCode session to show routing alongside it." })
      return false
    }
    status = next
    if (!unregister) {
      const solid = await loadSolidRuntime()
      if (!solid) {
        await ctx.ui.dialog.alert({ title: "Routing status", message: "The OpenCode panel renderer is unavailable. Use the routing dialog to view status." })
        return false
      }
      unregister = ctx.ui.slot({
        append: "session.panel",
        render(input) {
          if (input.name !== panelName || !status) return null
          const current = status
          const active = current.profiles[current.active] ?? current.legacy
          const main = ctx.ui.model.current()
          const decision = active.decision
          const ready = active.pool.mode === "paused" ? 0 : active.pool.mode === "all" ? current.models.filter(workerReady).length
            : active.pool.models.filter(model => !modelIssue(current, model, workerReady)).length
          const lines: ReturnType<typeof solid.createElement>[] = []
          const text = themeColor(ctx.theme.text)
          const muted = themeColor(ctx.theme.textMuted) ?? themeColor(ctx.theme.text, "muted")
          const add = (content: string, fg = text) => {
            lines.push(createTextNode(solid, content, { ...(fg ? { fg } : {}), wrapMode: "word" }))
          }
          add("Momo routing", themeColor(ctx.theme.primary))
          add(`Profile  ${current.active}`)
          add(`Main  ${main ? `${main.providerID}/${main.modelID}` : "Select in /models"}`)
          const label = decision.kind === "manual" ? "Caller selection" : decision.kind === "jev" ? current.jev.label : modelLabel(decision.model)
          add(`Decision  ${label}`)
          const issue = decision.kind === "jev" ? current.jev.reason : decision.kind === "chat" ? modelIssue(current, decision.model) : undefined
          if (issue) add(issue, themeColor(ctx.theme.warning))
          add(`Workers  ${ready} eligible · Advisors  ${active.advisors.length}`)
          const previous = current.lastDecision
          if (previous?.selected) add(`Last  ${previous.selected.role} · ${modelLabel(previous.selected.model)}`, muted)
          if (previous?.reason) add(previous.reason, muted)
          add("Edit or refresh with /momo-routing", muted)
          return createBoxNode(solid, { flexDirection: "column", paddingLeft: 1, paddingRight: 1, flexGrow: 1 }, lines)
        },
      })
    }
    if (ctx.ui.panel.current()?.name === panelName) ctx.ui.panel.close()
    return ctx.ui.panel.open(panelName, { presentation: "panel" })
  }
  return { show, dispose: () => unregister?.() }
}
