import {
  appendFilterChar,
  backspaceFilter,
  buildCardListNode,
  createFocusList,
  escFilterAction,
  filterCards,
  restyleCard,
  scrollCardIntoView,
  type CardDescriptor,
  type CardListNodeRefs,
  type CardTheme,
  type FocusList,
  type SolidRuntime,
} from "../../features/tui-card"
import { focusIndexPreservingId } from "../../features/subagent-tree/task-refresh"
import { registerCardKeymapV2 } from "./card-keymap-v2"
import type { V2TuiFacade } from "./tui-facade"

export type CardDialogV2Input<Node, Card extends CardDescriptor> = {
  readonly solid: SolidRuntime<Node>
  readonly facade: V2TuiFacade
  readonly mode: string
  readonly title: string
  readonly hint: () => string
  readonly footerHint: () => string | undefined
  readonly ghostLine: () => string | undefined
  readonly filterTexts: (card: Card) => readonly string[]
  readonly onActivate: (card: Card) => void
  readonly extraBindings?: readonly {
    readonly key: string
    readonly run: () => void
  }[]
}

export type CardDialogV2<Card extends CardDescriptor> = {
  readonly isOpen: () => boolean
  readonly focusedCard: () => Card | undefined
  readonly visibleCount: () => number
  readonly open: (cards: readonly Card[]) => void
  readonly refresh: (cards: readonly Card[]) => void
  readonly restyleAll: (cards: readonly Card[]) => void
  readonly close: () => void
  readonly suspend: () => void
}

type CardDialogState<Node, Card extends CardDescriptor> = {
  open: boolean
  popMode: (() => void) | null
  cards: readonly Card[]
  visible: readonly Card[]
  filterQuery: string
  nodeRefs: CardListNodeRefs<Node> | null
  focus: FocusList
}

/**
 * Shared V2 card-dialog controller: the dialog/mode/focus/filter state
 * machine both /tasks and /pool use, ported from the V1 register-*-tui
 * modules. Dialog mounting maps dialogStack.replace/setSize to
 * ui.dialog.show/set; mode push maps api.mode.push to keymap.mode.push.
 */
export function createCardDialogV2<Node, Card extends CardDescriptor>(
  input: CardDialogV2Input<Node, Card>,
): CardDialogV2<Card> {
  const state: CardDialogState<Node, Card> = {
    open: false,
    popMode: null,
    cards: [],
    visible: [],
    filterQuery: "",
    nodeRefs: null,
    focus: createFocusList(0),
  }

  const theme = (): CardTheme => input.facade.theme()
  const requestRender = (): void => input.facade.requestRender()

  const releaseMode = (): void => {
    state.popMode?.()
    state.popMode = null
  }

  const suspend = (): void => {
    state.open = false
    releaseMode()
  }

  const close = (): void => {
    if (!state.open) return
    state.open = false
    releaseMode()
    input.facade.clearDialog()
    requestRender()
  }

  const activateMode = (): void => {
    setTimeout(() => {
      if (!state.open || state.popMode !== null) return
      state.popMode = input.facade.pushMode(input.mode)
    }, 0)
  }

  const mountDialog = (build: () => CardListNodeRefs<Node>): void => {
    input.facade.showDialog(
      () => {
        const refs = build()
        state.nodeRefs = refs
        return refs.root
      },
      () => suspend(),
    )
    input.facade.setDialogSize("xlarge")
  }

  const buildNodeList = (): CardListNodeRefs<Node> =>
    buildCardListNode(input.solid, {
      title: input.title,
      hint: input.hint(),
      filterQuery: state.filterQuery,
      footerHint: input.footerHint(),
      ghostLine: input.ghostLine(),
      groups: [{ header: undefined, cards: state.visible }],
      focusedIndex: state.focus.current(),
      theme: theme(),
      scrollRows: scrollRows(),
      onCardHover: focusCardAt,
      onCardActivate: activateCardAt,
    })

  const scrollRows = (): number => {
    const height = input.facade.rendererHeight()
    const topOffset = Math.floor(height / 4)
    return Math.max(3, height - topOffset - 7)
  }

  const followFocus = (): void => {
    const card = state.visible[state.focus.current()]
    const refs = state.nodeRefs
    if (card === undefined || refs === null) return
    setTimeout(() => {
      if (!state.open) return
      scrollCardIntoView(refs, card.id)
      requestRender()
    }, 0)
  }

  const remountFiltered = (): void => {
    if (!state.open) return
    state.visible = filterCards(state.cards, state.filterQuery, input.filterTexts)
    state.focus.reseat(state.visible.length)
    state.focus.reset()
    mountDialog(buildNodeList)
    state.open = true
    activateMode()
    requestRender()
  }

  const restyleFocus = (previous: number, next: number): void => {
    const refs = state.nodeRefs?.cards
    if (refs === undefined) return
    const previousRef = refs[previous]
    const nextRef = refs[next]
    if (previousRef !== undefined) {
      restyleCard(input.solid, previousRef, state.visible[previous], false, theme())
    }
    if (nextRef !== undefined) {
      restyleCard(input.solid, nextRef, state.visible[next], true, theme())
    }
  }

  const focusCardAt = (index: number): void => {
    if (!state.open || state.nodeRefs === null) return
    const previous = state.focus.current()
    if (previous === index) return
    state.focus.seek(index)
    restyleFocus(previous, index)
    followFocus()
    requestRender()
  }

  const moveFocusBy = (delta: number): void => {
    if (!state.open) return
    const previous = state.focus.current()
    if (!state.focus.move(delta)) return
    restyleFocus(previous, state.focus.current())
    followFocus()
    requestRender()
  }

  const activate = (): void => {
    if (!state.open) return
    const card = state.visible[state.focus.current()]
    if (card === undefined) return
    input.onActivate(card)
  }

  const activateCardAt = (index: number): void => {
    if (!state.open) return
    if (input.facade.selectionText()) return
    state.focus.seek(index)
    activate()
  }

  const handleFilterChar = (char: string): void => {
    if (!state.open) return
    state.filterQuery = appendFilterChar(state.filterQuery, char)
    remountFiltered()
  }

  const handleFilterBackspace = (): void => {
    if (!state.open) return
    state.filterQuery = backspaceFilter(state.filterQuery)
    remountFiltered()
  }

  const handleClose = (): void => {
    if (!state.open) return
    if (escFilterAction(state.filterQuery) === "clear") {
      state.filterQuery = ""
      remountFiltered()
      return
    }
    close()
  }

  registerCardKeymapV2(input.facade, input.mode, {
    onMoveUp: () => moveFocusBy(-1),
    onMoveDown: () => moveFocusBy(1),
    onActivate: activate,
    onClose: handleClose,
    onFilterChar: handleFilterChar,
    onFilterBackspace: handleFilterBackspace,
    extraBindings: input.extraBindings,
  })

  return {
    isOpen: () => state.open,
    focusedCard: () => state.visible[state.focus.current()],
    visibleCount: () => state.visible.length,
    open: (cards) => {
      if (state.open) {
        close()
      }
      state.cards = cards
      state.filterQuery = ""
      state.visible = cards
      state.focus = createFocusList(state.visible.length)
      state.open = true
      mountDialog(buildNodeList)
      activateMode()
      requestRender()
    },
    refresh: (cards) => {
      const previousId = state.visible[state.focus.current()]?.id
      state.cards = cards
      state.visible = filterCards(state.cards, state.filterQuery, input.filterTexts)
      state.focus.reseat(state.visible.length)
      state.focus.seek(
        focusIndexPreservingId(state.visible, previousId, state.focus.current()),
      )
      mountDialog(buildNodeList)
      state.open = true
      followFocus()
      requestRender()
    },
    restyleAll: (cards) => {
      if (!state.open || state.nodeRefs === null) return
      state.cards = cards
      state.visible = filterCards(state.cards, state.filterQuery, input.filterTexts)
      state.focus.reseat(state.visible.length)
      const refs = state.nodeRefs.cards
      for (let index = 0; index < refs.length; index += 1) {
        const card = state.visible[index]
        const ref = refs[index]
        if (card === undefined || ref === undefined) continue
        restyleCard(input.solid, ref, card, index === state.focus.current(), theme())
      }
    },
    close,
    suspend,
  }
}
