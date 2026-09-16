import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

export type CardKeymapActions = {
  readonly onMoveUp: () => void
  readonly onMoveDown: () => void
  readonly onActivate: () => void
  readonly onClose: () => void
  readonly onFilterChar?: (char: string) => void
  readonly onFilterBackspace?: () => void
  readonly filterChars?: readonly string[]
  readonly extraBindings?: readonly {
    readonly key: string
    readonly run: () => void
  }[]
}

export type CardKeymapLayer = {
  readonly mode: string
  readonly unregister: () => void
}

/**
 * Printable characters routed to the type-to-filter input.
 */
export const DEFAULT_FILTER_CHARS =
  "abcdefghijklmnopqrstuvwxyz0123456789-._/ @+#".split("")

/**
 * Registers a keymap layer scoped to `mode`. The layer is inert whenever the
 * mode is not current (the dialog is closed and the mode popped), mirroring
 * the btw-side keymap wiring.
 */
export function registerCardKeymap(
  api: TuiPluginApi,
  mode: string,
  actions: CardKeymapActions,
): CardKeymapLayer {
  const filterBindings = actions.onFilterChar
    ? (actions.filterChars ?? DEFAULT_FILTER_CHARS).map((char) => ({
        key: char,
        cmd: () => actions.onFilterChar?.(char),
        preventDefault: true,
        fallthrough: false,
      }))
    : []
  const backspaceBindings = actions.onFilterBackspace
    ? [
        {
          key: "backspace",
          cmd: () => actions.onFilterBackspace?.(),
          preventDefault: true,
          fallthrough: false,
        },
      ]
    : []
  const bindings = [
    { key: "up", cmd: () => actions.onMoveUp(), preventDefault: true, fallthrough: false },
    { key: "down", cmd: () => actions.onMoveDown(), preventDefault: true, fallthrough: false },
    { key: "j", cmd: () => actions.onMoveDown(), preventDefault: true, fallthrough: false },
    { key: "k", cmd: () => actions.onMoveUp(), preventDefault: true, fallthrough: false },
    { key: "enter,return", cmd: () => actions.onActivate(), preventDefault: true, fallthrough: false },
    { key: "escape", cmd: () => actions.onClose(), preventDefault: true, fallthrough: false },
    ...filterBindings,
    ...backspaceBindings,
    ...(actions.extraBindings ?? []).map((extra) => ({
      key: extra.key,
      cmd: () => extra.run(),
      preventDefault: true,
      fallthrough: false,
    })),
  ]
  const unregister = api.keymap.registerLayer({
    mode,
    priority: 20_000,
    bindings,
  })
  return { mode, unregister }
}
