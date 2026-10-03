import { describe, expect, it } from "bun:test"

import { createV2TuiFacade } from "./tui-facade"
import {
  createFakeSolidRuntime,
  createFakeV2TuiContext,
} from "./fake-tui-context"

describe("#given a V2 TUI context with a location", () => {
  it("#when creating the facade #then directory reads the location directory", () => {
    const fake = createFakeV2TuiContext({ directory: "/work/project" })
    const facade = createV2TuiFacade(fake.ctx)

    expect(facade.directory()).toBe("/work/project")
    expect(fake.defaultLocationCalls).toBe(0)
  })
})

describe("#given a V2 TUI context without a location", () => {
  it("#when creating the facade #then directory falls back to the default location", () => {
    const fake = createFakeV2TuiContext({ defaultDirectory: "/default/project" })
    const facade = createV2TuiFacade(fake.ctx)

    expect(facade.directory()).toBe("/default/project")
    expect(fake.defaultLocationCalls).toBeGreaterThan(0)
  })
})

describe("#given a facade over a V2 TUI context", () => {
  it("#when toast is called #then ui.toast.show receives variant and message", () => {
    const fake = createFakeV2TuiContext()
    const facade = createV2TuiFacade(fake.ctx)

    facade.toast({ variant: "warning", message: "careful" })

    expect(fake.toasts).toHaveLength(1)
    expect(fake.toasts[0]?.variant).toBe("warning")
    expect(fake.toasts[0]?.message).toBe("careful")
  })

  it("#when dialog helpers are called #then they map onto ui.dialog show, set, and clear", () => {
    const fake = createFakeV2TuiContext()
    const facade = createV2TuiFacade(fake.ctx)
    const render = () => null

    facade.showDialog(render, undefined)
    facade.setDialogSize("xlarge")
    facade.clearDialog()

    expect(fake.dialogShows).toHaveLength(1)
    expect(fake.dialogShows[0]?.render).toBe(render)
    expect(fake.dialogSizes).toEqual(["xlarge"])
    expect(fake.dialogClears).toBe(1)
  })

  it("#when pushMode is called #then keymap.mode.push records the mode and returns the pop", () => {
    const fake = createFakeV2TuiContext()
    const facade = createV2TuiFacade(fake.ctx)

    const pop = facade.pushMode("omo.tui-card.tasks")
    pop()

    expect(fake.pushedModes).toEqual(["omo.tui-card.tasks"])
    expect(fake.poppedModes).toBe(1)
  })

  it("#when renderer helpers are called #then they map onto the renderer", () => {
    const fake = createFakeV2TuiContext({ height: 55 })
    const facade = createV2TuiFacade(fake.ctx)

    expect(facade.rendererHeight()).toBe(55)
    expect(facade.selectionText()).toBeUndefined()

    facade.requestRender()
    expect(fake.renderRequests).toBe(1)
  })

  it("#when addKeymapLayer is called #then keymap.layer records the layer input", () => {
    const fake = createFakeV2TuiContext()
    const facade = createV2TuiFacade(fake.ctx)
    const solid = createFakeSolidRuntime()

    facade.addKeymapLayer(() => ({ mode: "global", commands: [] }), solid)

    expect(fake.keymapLayers).toHaveLength(1)
    expect(fake.keymapLayers[0]?.().mode).toBe("global")
  })
})

describe("#given facade cleanup registrations", () => {
  it("#when runCleanups is called #then every cleanup runs once in registration order", () => {
    const fake = createFakeV2TuiContext()
    const facade = createV2TuiFacade(fake.ctx)
    const calls: string[] = []

    facade.onCleanup(() => calls.push("first"))
    facade.onCleanup(() => calls.push("second"))

    facade.runCleanups()
    facade.runCleanups()

    expect(calls).toEqual(["first", "second"])
  })
})
