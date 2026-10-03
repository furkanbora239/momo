import type { DialogSize, KeymapLayer, ToastVariant } from "@opencode/plugin/tui/context"
import type { JSX } from "@opentui/solid/jsx-runtime"

import { log } from "../../shared/logger"
import type { CardTheme, SolidRuntime } from "../../features/tui-card"
import type { SolidNode } from "./solid-loader"
import type { V2TuiContext } from "./types"

export type V2TuiToastInput = {
  readonly variant?: ToastVariant
  readonly message: string
}

/**
 * The slice of the V2 TUI context the ported momo features consume. Maps the
 * V1 api surface (api.ui.toast, api.ui.dialog stack, api.mode.push,
 * api.theme.current, api.state.path.directory, api.renderer.*,
 * api.lifecycle.onDispose) onto the V2 equivalents.
 */
export type V2TuiFacade = {
  readonly directory: () => string | undefined
  readonly requestRender: () => void
  readonly rendererHeight: () => number
  readonly selectionText: () => string | undefined
  readonly toast: (input: V2TuiToastInput) => void
  readonly showDialog: (render: () => JSX.Element, onClose?: () => void) => void
  readonly setDialogSize: (size: DialogSize) => void
  readonly clearDialog: () => void
  readonly pushMode: (mode: string) => () => void
  readonly addKeymapLayer: <Node>(
    input: () => KeymapLayer,
    solid: SolidRuntime<Node>,
  ) => void
  readonly theme: () => CardTheme
  readonly onCleanup: (fn: () => void) => void
  readonly runCleanups: () => void
}

export function createV2TuiFacade(ctx: V2TuiContext): V2TuiFacade {
  const cleanups: (() => void)[] = []
  return {
    directory: () =>
      ctx.location?.directory ?? ctx.data.location.default().directory,
    requestRender: () => {
      ctx.renderer.requestRender()
    },
    rendererHeight: () => ctx.renderer.height,
    selectionText: () => ctx.renderer.getSelection()?.getSelectedText(),
    toast: (input) => {
      ctx.ui.toast.show({ variant: input.variant, message: input.message })
    },
    showDialog: (render, onClose) => {
      ctx.ui.dialog.show(render, onClose)
    },
    setDialogSize: (size) => {
      ctx.ui.dialog.set({ size })
    },
    clearDialog: () => {
      ctx.ui.dialog.clear()
    },
    pushMode: (mode) => ctx.keymap.mode.push(mode),
    addKeymapLayer: <Node>(input: () => KeymapLayer, solid: SolidRuntime<Node>) => {
      // opencode v2 owns keymap layers by the calling component: creating
      // one at plugin setup time runs outside the Solid tree and fails with
      // "Keymap.Provider is missing". Claim the always-mounted `app` slot
      // and create the layer on first render, inside the host's tree.
      let created = false
      ctx.ui.slot({
        append: "app",
        render: () => {
          if (!created) {
            created = true
            try {
              ctx.keymap.layer(input)
              log("[v2-keymap-host] keymap layer created inside app slot")
            } catch (error) {
              log("[v2-keymap-host] keymap layer creation failed", {
                error:
                  error instanceof Error ? error.message : String(error),
              })
            }
          }
          return solid.createElement("box")
        },
      })
    },
    theme: () => ctx.theme,
    onCleanup: (fn) => {
      cleanups.push(fn)
    },
    runCleanups: () => {
      for (const cleanup of cleanups.splice(0)) {
        cleanup()
      }
    },
  }
}

export type SolidRuntimeHandle = SolidRuntime<SolidNode>
