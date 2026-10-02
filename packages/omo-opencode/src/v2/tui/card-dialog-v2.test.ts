import { describe, expect, it } from "bun:test"

import type { CardDescriptor } from "../../features/tui-card"
import { createCardDialogV2 } from "./card-dialog-v2"
import {
  createFakeSolidRuntime,
  createFakeV2TuiContext,
  flushTimeoutZero,
  type FakeSolidNode,
} from "./fake-tui-context"
import { createV2TuiFacade } from "./tui-facade"

const MODE = "omo.tui-card.test"

function card(id: string): CardDescriptor {
  return { id, title: id, badge: undefined, bodyLines: ["body"], indent: 0 }
}

type Harness = {
  readonly fake: ReturnType<typeof createFakeV2TuiContext>
  readonly dialog: ReturnType<typeof createCardDialogV2<FakeSolidNode, CardDescriptor>>
  readonly activated: CardDescriptor[]
  readonly solid: ReturnType<typeof createFakeSolidRuntime>
}

function createHarness(cards: readonly CardDescriptor[] = []): Harness {
  const fake = createFakeV2TuiContext()
  const facade = createV2TuiFacade(fake.ctx)
  const solid = createFakeSolidRuntime()
  const activated: CardDescriptor[] = []
  const dialog = createCardDialogV2<FakeSolidNode, CardDescriptor>({
    solid,
    facade,
    mode: MODE,
    title: "Cards",
    hint: () => "hint",
    footerHint: () => undefined,
    ghostLine: () => (dialog.visibleCount() === 0 ? "no cards" : undefined),
    filterTexts: (item) => [item.title],
    onActivate: (item) => activated.push(item),
  })
  if (cards.length > 0) {
    dialog.open(cards)
  }
  return { fake, dialog, activated, solid }
}

function findNodeById(node: FakeSolidNode, id: string): FakeSolidNode | undefined {
  if (node.props.id === id) return node
  for (const child of node.children) {
    if (child !== null && typeof child === "object" && "props" in child) {
      const found = findNodeById(child as FakeSolidNode, id)
      if (found !== undefined) return found
    }
  }
  return undefined
}

function cardLayerCommands(
  fake: ReturnType<typeof createFakeV2TuiContext>,
): { readonly bind?: false | string; readonly run: (input?: string) => unknown }[] {
  for (const layer of fake.keymapLayers) {
    const resolved = layer()
    if (resolved.mode === MODE) {
      return resolved.commands ?? []
    }
  }
  return []
}

function runBound(
  fake: ReturnType<typeof createFakeV2TuiContext>,
  bind: string,
): void {
  for (const command of cardLayerCommands(fake)) {
    if (command.bind === bind) {
      command.run()
      return
    }
  }
  throw new Error(`no command bound to ${bind}`)
}

describe("#given a closed card dialog", () => {
  it("#when opened with cards #then the dialog is shown xlarge, the mode is pushed, and the first card is focused", async () => {
    const harness = createHarness()
    harness.dialog.open([card("alpha"), card("beta")])
    await flushTimeoutZero()

    expect(harness.dialog.isOpen()).toBe(true)
    expect(harness.fake.dialogShows).toHaveLength(1)
    expect(harness.fake.dialogSizes).toEqual(["xlarge"])
    expect(harness.fake.pushedModes).toEqual([MODE])
    expect(harness.dialog.focusedCard()?.id).toBe("alpha")
    expect(harness.fake.renderRequests).toBeGreaterThan(0)
  })

  it("#when opened with no cards #then the ghost line renders", async () => {
    const harness = createHarness()
    harness.dialog.open([])
    await flushTimeoutZero()

    const rendered = harness.fake.dialogShows[0]?.render() as FakeSolidNode
    expect(findNodeById(rendered, "alpha")).toBeUndefined()
    expect(rendered.tag).toBe("box")
    expect(harness.dialog.visibleCount()).toBe(0)
  })
})

describe("#given an open card dialog", () => {
  it("#when the move commands run #then focus moves and activate dispatches the focused card", async () => {
    const harness = createHarness([card("alpha"), card("beta"), card("gamma")])
    await flushTimeoutZero()

    runBound(harness.fake, "down")
    runBound(harness.fake, "down")

    expect(harness.dialog.focusedCard()?.id).toBe("gamma")

    runBound(harness.fake, "up")
    expect(harness.dialog.focusedCard()?.id).toBe("beta")

    runBound(harness.fake, "enter")
    expect(harness.activated.map((item) => item.id)).toEqual(["beta"])
  })

  it("#when a filter char command runs #then only matching cards stay visible", async () => {
    const harness = createHarness([card("alpha"), card("beta")])
    await flushTimeoutZero()

    runBound(harness.fake, "b")

    expect(harness.dialog.visibleCount()).toBe(1)
    expect(harness.dialog.focusedCard()?.id).toBe("beta")
    expect(harness.fake.dialogShows).toHaveLength(2)

    const rendered = harness.fake.dialogShows[1]?.render() as FakeSolidNode
    expect(findNodeById(rendered, "alpha")).toBeUndefined()
    expect(findNodeById(rendered, "beta")).toBeDefined()
  })

  it("#when escape runs with an active filter #then the filter clears first and the second escape closes", async () => {
    const harness = createHarness([card("alpha"), card("beta")])
    await flushTimeoutZero()

    runBound(harness.fake, "b")
    runBound(harness.fake, "escape")
    expect(harness.dialog.isOpen()).toBe(true)
    expect(harness.dialog.visibleCount()).toBe(2)

    runBound(harness.fake, "escape")
    expect(harness.dialog.isOpen()).toBe(false)
    expect(harness.fake.dialogClears).toBe(1)
    expect(harness.fake.poppedModes).toBe(1)
  })

  it("#when the host closes the dialog #then the dialog suspends without clearing", async () => {
    const harness = createHarness([card("alpha")])
    await flushTimeoutZero()

    harness.fake.dialogShows[0]?.onClose?.()

    expect(harness.dialog.isOpen()).toBe(false)
    expect(harness.fake.poppedModes).toBe(1)
    expect(harness.fake.dialogClears).toBe(0)
  })
})

describe("#given an open dialog with a rendered node list", () => {
  it("#when refresh replaces the cards #then focus is preserved by card id", async () => {
    const harness = createHarness([card("alpha"), card("beta"), card("gamma")])
    await flushTimeoutZero()
    runBound(harness.fake, "down")
    expect(harness.dialog.focusedCard()?.id).toBe("beta")

    harness.dialog.refresh([card("alpha"), card("beta-v2"), card("gamma")])

    expect(harness.dialog.focusedCard()?.id).toBe("beta-v2")
    expect(harness.fake.dialogShows).toHaveLength(2)
  })

  it("#when restyleAll replaces card styles #then no new dialog is shown and the focused card restyles in place", async () => {
    const harness = createHarness([card("alpha"), card("beta")])
    await flushTimeoutZero()
    harness.fake.dialogShows[0]?.render()
    runBound(harness.fake, "down")

    const before = harness.dialog.focusedCard()?.title
    harness.dialog.restyleAll([
      { ...card("alpha"), title: "alpha!" },
      { ...card("beta"), title: "beta!" },
    ])

    expect(harness.fake.dialogShows).toHaveLength(1)
    expect(before).toBe("beta")
    expect(harness.dialog.focusedCard()?.title).toBe("beta!")
  })
})
