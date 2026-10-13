import type { V2TuiContext } from "./types"
import type { SolidRuntime } from "../../features/tui-card"
import type { SolidNode } from "./solid-loader"
import { createNativeTaskPoller } from "./native-task-poller"
import { nativeTaskViewText, type NativeTaskView } from "./native-task-view"

export type NativeTaskReactiveRuntime = {
  createEffect: (effect: () => void) => void
  onCleanup: (cleanup: () => void) => void
  createSignal: <T>(initial: T) => [() => T, (value: T) => unknown]
}

/** Mount only native task RPC state; OpenCode supplies the current sidebar session. */
export function registerNativeTaskSidebar(
  ctx: V2TuiContext,
  solid: SolidRuntime<SolidNode>,
  reactive: NativeTaskReactiveRuntime,
): () => void {
  const mounted = new Set<() => void>()
  const unregister = ctx.ui.slot({
    append: "sidebar.content",
    render: (scope) => {
      const [view, setView] = reactive.createSignal<NativeTaskView>({ status: "loading", rows: [] })
      const poller = createNativeTaskPoller({
        read: async (rootSessionID, signal) => {
          const response = await ctx.client.rpc.call({
            rpcID: "momo.native", method: "tasks",
            location: ctx.location ?? ctx.data.location.default(), input: { rootSessionID },
          }, { signal })
          return response.output
        },
        update: setView,
      })
      const dispose = () => { poller.dispose(); mounted.delete(dispose) }
      mounted.add(dispose)
      reactive.onCleanup(dispose)
      reactive.createEffect(() => {
        poller.setScope(scope.sessionID ? ctx.data.session.root(scope.sessionID) : undefined)
      })
      const box = solid.createElement("box")
      solid.setProp(box, "flexDirection", "column")
      solid.setProp(box, "paddingTop", 1)
      const scroll = solid.createElement("scrollbox")
      solid.setProp(scroll, "maxHeight", 20)
      solid.setProp(scroll, "scrollX", false)
      const text = solid.createElement("text")
      solid.setProp(text, "wrapMode", "word")
      solid.setProp(text, "width", "100%")
      reactive.createEffect(() => {
        solid.setProp(text, "content", nativeTaskViewText(view()))
      })
      solid.insert(scroll, text)
      solid.insert(box, scroll)
      return box
    },
  })
  return () => {
    for (const dispose of [...mounted]) dispose()
    unregister()
  }
}

export async function loadNativeTaskSidebar(ctx: V2TuiContext): Promise<() => void> {
  // Both imports stay external in the TUI bundle and are supplied by the host.
  const [solid, reactive] = await Promise.all([import("@opentui/solid"), import("solid-js")])
  return registerNativeTaskSidebar(ctx, solid, reactive)
}
