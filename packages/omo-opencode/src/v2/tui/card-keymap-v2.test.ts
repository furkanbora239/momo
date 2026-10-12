import { describe, expect, it } from "bun:test"

import { registerCardKeymapV2 } from "./card-keymap-v2"
import { createFakeSolidRuntime, createFakeV2TuiContext } from "./fake-tui-context"
import { createV2TuiFacade } from "./tui-facade"

function bindOf(command: { readonly bind?: false | string }): string {
  return typeof command.bind === "string" ? command.bind : ""
}

function commandsOf(fake: ReturnType<typeof createFakeV2TuiContext>): {
  readonly bind?: false | string
  readonly run: (input?: string) => unknown
}[] {
  const layer = fake.keymapLayers[0]?.()
  return layer?.commands ?? []
}

describe("#given card keymap actions", () => {
  it("#when registered #then a mode-scoped priority layer is added", () => {
    const fake = createFakeV2TuiContext()
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()

    registerCardKeymapV2(facade, solid, "omo.tui-card.tasks", {
      onMoveUp: () => undefined,
      onMoveDown: () => undefined,
      onActivate: () => undefined,
      onClose: () => undefined,
    })

    expect(fake.keymapLayers).toHaveLength(1)
    const layer = fake.keymapLayers[0]?.()
    expect(layer?.mode).toBe("omo.tui-card.tasks")
    expect(layer?.priority).toBe(20_000)
  })

  it("#when registered #then navigation and control keys are bound as inline commands", () => {
    const fake = createFakeV2TuiContext()
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()

    registerCardKeymapV2(facade, solid, "omo.tui-card.tasks", {
      onMoveUp: () => undefined,
      onMoveDown: () => undefined,
      onActivate: () => undefined,
      onClose: () => undefined,
    })

    const binds = commandsOf(fake).map(bindOf)
    expect(binds).toContain("up")
    expect(binds).toContain("down")
    expect(binds).toContain("j")
    expect(binds).toContain("k")
    expect(binds).toContain("enter")
    expect(binds).toContain("escape")
    expect(binds).not.toContain("backspace")
  })

  it("#when a command runs #then it dispatches to the matching action", () => {
    const fake = createFakeV2TuiContext()
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()
    const calls: string[] = []

    registerCardKeymapV2(facade, solid, "omo.tui-card.tasks", {
      onMoveUp: () => calls.push("up"),
      onMoveDown: () => calls.push("down"),
      onActivate: () => calls.push("activate"),
      onClose: () => calls.push("close"),
    })

    const commands = commandsOf(fake)
    for (const command of commands) {
      if (bindOf(command) === "k") command.run()
      if (bindOf(command) === "down") command.run()
      if (bindOf(command) === "enter") command.run()
      if (bindOf(command) === "escape") command.run()
    }

    expect(calls).toEqual(["up", "down", "activate", "close"])
  })
})

describe("#given card keymap actions with a type-to-filter input", () => {
  it("#when registered #then every filter char and backspace are bound", () => {
    const fake = createFakeV2TuiContext()
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()

    registerCardKeymapV2(facade, solid, "omo.tui-card.pool", {
      onMoveUp: () => undefined,
      onMoveDown: () => undefined,
      onActivate: () => undefined,
      onClose: () => undefined,
      onFilterChar: () => undefined,
      onFilterBackspace: () => undefined,
      filterChars: ["a", "b"],
    })

    const binds = commandsOf(fake).map(bindOf)
    expect(binds).toContain("a")
    expect(binds).toContain("b")
    expect(binds).toContain("backspace")
    expect(binds).not.toContain("c")
  })

  it("#when a filter char command runs #then it dispatches the char to the action", () => {
    const fake = createFakeV2TuiContext()
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()
    const chars: string[] = []

    registerCardKeymapV2(facade, solid, "omo.tui-card.pool", {
      onMoveUp: () => undefined,
      onMoveDown: () => undefined,
      onActivate: () => undefined,
      onClose: () => undefined,
      onFilterChar: (char) => chars.push(char),
      filterChars: ["x"],
    })

    const commands = commandsOf(fake)
    for (const command of commands) {
      if (bindOf(command) === "x") command.run()
    }

    expect(chars).toEqual(["x"])
  })
})

describe("#given card keymap actions with extra bindings", () => {
  it("#when registered #then the extra key is bound and dispatches to its run", () => {
    const fake = createFakeV2TuiContext()
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()
    const calls: string[] = []

    registerCardKeymapV2(facade, solid, "omo.tui-card.pool", {
      onMoveUp: () => undefined,
      onMoveDown: () => undefined,
      onActivate: () => undefined,
      onClose: () => undefined,
      extraBindings: [{ key: "alt+c", run: () => calls.push("cleared") }],
    })

    const commands = commandsOf(fake)
    for (const command of commands) {
      if (bindOf(command) === "alt+c") command.run()
    }

    expect(calls).toEqual(["cleared"])
  })
})
