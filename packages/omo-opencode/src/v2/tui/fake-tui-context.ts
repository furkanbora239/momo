import type {
  DialogSelectOptions,
  KeymapLayer,
  SlotClaim,
  ToastOptions,
} from "@opencode/plugin/tui/context"

import type { CardTheme, SolidRuntime } from "../../features/tui-card"
import type { V2TuiContext } from "./types"

export type FakeSolidNode = {
  readonly tag: string
  props: Record<string, unknown>
  children: unknown[]
}

export type FakeSolidRuntime = SolidRuntime<FakeSolidNode> & {
  readonly created: readonly FakeSolidNode[]
}

export function createFakeSolidRuntime(): FakeSolidRuntime {
  const created: FakeSolidNode[] = []
  return {
    created,
    createElement: (tag: string): FakeSolidNode => {
      const node: FakeSolidNode = { tag, props: {}, children: [] }
      created.push(node)
      return node
    },
    insert: (parent: FakeSolidNode, child: unknown): void => {
      parent.children.push(child)
    },
    setProp: (node: FakeSolidNode, name: string, value: unknown): void => {
      node.props[name] = value
    },
  }
}

export type FakeMessage = { readonly type: string; readonly text?: string }

export type FakeSlotClaimRecord = {
  readonly claim: SlotClaim
  unregistered: boolean
}

export type FakeDialogShowRecord = {
  readonly render: () => unknown
  readonly onClose: (() => void) | undefined
}

export type FakeV2TuiContextInput = {
  readonly directory?: string
  readonly defaultDirectory?: string
  readonly height?: number
  readonly theme?: CardTheme
  readonly messages?: readonly FakeMessage[]
  readonly fetchedMessages?: readonly FakeMessage[]
  readonly selectResult?: unknown
}

export type FakeV2TuiContext = {
  readonly ctx: V2TuiContext
  readonly toasts: ToastOptions[]
  readonly dialogShows: FakeDialogShowRecord[]
  readonly dialogSizes: string[]
  readonly dialogClears: number
  readonly dialogSelects: DialogSelectOptions<unknown>[]
  readonly slotClaims: FakeSlotClaimRecord[]
  readonly keymapLayers: (() => KeymapLayer)[]
  readonly pushedModes: string[]
  readonly poppedModes: number
  readonly renderRequests: number
  readonly messageSyncs: string[]
  readonly clientMessageListCalls: unknown[]
  readonly defaultLocationCalls: number
}

const FALLBACK_THEME: CardTheme = {
  primary: "#primary",
  accent: "#accent",
  success: "#success",
  error: "#error",
  warning: "#warning",
  text: "#text",
  textMuted: "#muted",
  borderActive: "#border-active",
  borderSubtle: "#border-subtle",
}

/**
 * Synthetic V2 TUI context with registration recorders: every slot claim,
 * keymap layer, dialog, toast, mode push, render request, and data/client
 * call is recorded so tests can assert the wiring without any real
 * @opentui import or host.
 */
export function createFakeV2TuiContext(
  input: FakeV2TuiContextInput = {},
): FakeV2TuiContext {
  const toasts: ToastOptions[] = []
  const dialogShows: FakeDialogShowRecord[] = []
  const dialogSizes: string[] = []
  let dialogClears = 0
  const dialogSelects: DialogSelectOptions<unknown>[] = []
  const slotClaims: FakeSlotClaimRecord[] = []
  const keymapLayers: (() => KeymapLayer)[] = []
  const pushedModes: string[] = []
  let poppedModes = 0
  let renderRequests = 0
  const messageSyncs: string[] = []
  const clientMessageListCalls: unknown[] = []
  let defaultLocationCalls = 0

  const ctx = {
    options: {},
    location: input.directory === undefined ? undefined : { directory: input.directory },
    app: { version: "test", channel: "test" },
    renderer: {
      requestRender: () => {
        renderRequests += 1
      },
      height: input.height ?? 40,
      getSelection: () => null,
    },
    client: {
      message: {
        list: (call: unknown) => {
          clientMessageListCalls.push(call)
          return Promise.resolve({ data: input.fetchedMessages ?? [], cursor: {} })
        },
      },
    },
    data: {
      location: {
        default: () => {
          defaultLocationCalls += 1
          return { directory: input.defaultDirectory ?? "/fake/project" }
        },
      },
      session: {
        message: {
          list: () => input.messages ?? [],
          sync: (sessionID: string) => {
            messageSyncs.push(sessionID)
            return Promise.resolve()
          },
        },
      },
    },
    theme: input.theme ?? FALLBACK_THEME,
    themeMode: "dark",
    keymap: {
      layer: (layerInput: () => KeymapLayer) => {
        keymapLayers.push(layerInput)
      },
      mode: {
        push: (mode: string) => {
          pushedModes.push(mode)
          return () => {
            poppedModes += 1
          }
        },
      },
    },
    ui: {
      toast: {
        show: (options: ToastOptions) => {
          toasts.push(options)
        },
      },
      dialog: {
        show: (render: () => unknown, onClose?: () => void) => {
          dialogShows.push({ render, onClose })
        },
        set: (options: { readonly size?: string }) => {
          if (options.size !== undefined) dialogSizes.push(options.size)
        },
        clear: () => {
          dialogClears += 1
        },
        select: <Value>(options: DialogSelectOptions<Value>) => {
          dialogSelects.push(options as DialogSelectOptions<unknown>)
          return Promise.resolve(input.selectResult as Value | undefined)
        },
      },
      slot: (claim: SlotClaim) => {
        const record: FakeSlotClaimRecord = { claim, unregistered: false }
        slotClaims.push(record)
        return () => {
          record.unregistered = true
        }
      },
    },
  } as unknown as V2TuiContext

  return {
    ctx,
    toasts,
    dialogShows,
    dialogSizes,
    get dialogClears(): number {
      return dialogClears
    },
    dialogSelects,
    slotClaims,
    keymapLayers,
    pushedModes,
    get poppedModes(): number {
      return poppedModes
    },
    get renderRequests(): number {
      return renderRequests
    },
    messageSyncs,
    clientMessageListCalls,
    get defaultLocationCalls(): number {
      return defaultLocationCalls
    },
  }
}

export function flushTimeoutZero(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}
