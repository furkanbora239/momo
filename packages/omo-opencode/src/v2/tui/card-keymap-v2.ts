import type { KeymapCommand } from "@opencode/plugin/tui/context"

import {
  DEFAULT_FILTER_CHARS,
  type SolidRuntime,
} from "../../features/tui-card"
import type { V2TuiFacade } from "./tui-facade"

export type CardKeymapActionsV2 = {
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

export type CardKeymapLayerV2 = {
  readonly mode: string
}

const CARD_LAYER_PRIORITY = 20_000

/**
 * V2 port of registerCardKeymap: the V1 raw binding layer
 * ({key, cmd, preventDefault, fallthrough}) becomes a mode-scoped keymap
 * layer of inline commands, each auto-bound with `bind`. V2 layers are owned
 * by the calling component and disposed with it, so there is no manual
 * unregister to return.
 */
export function registerCardKeymapV2<Node>(
  facade: V2TuiFacade,
  solid: SolidRuntime<Node>,
  mode: string,
  actions: CardKeymapActionsV2,
): CardKeymapLayerV2 {
  const commands: KeymapCommand[] = [
    { bind: "up", run: () => actions.onMoveUp() },
    { bind: "k", run: () => actions.onMoveUp() },
    { bind: "down", run: () => actions.onMoveDown() },
    { bind: "j", run: () => actions.onMoveDown() },
    { bind: "enter", run: () => actions.onActivate() },
    { bind: "escape", run: () => actions.onClose() },
  ]
  if (actions.onFilterChar !== undefined) {
    for (const char of actions.filterChars ?? DEFAULT_FILTER_CHARS) {
      commands.push({ bind: char, run: () => actions.onFilterChar?.(char) })
    }
  }
  if (actions.onFilterBackspace !== undefined) {
    commands.push({ bind: "backspace", run: () => actions.onFilterBackspace?.() })
  }
  for (const extra of actions.extraBindings ?? []) {
    commands.push({ bind: extra.key, run: () => extra.run() })
  }
  facade.addKeymapLayer(
    () => ({ mode, priority: CARD_LAYER_PRIORITY, commands }),
    solid,
  )
  return { mode }
}
