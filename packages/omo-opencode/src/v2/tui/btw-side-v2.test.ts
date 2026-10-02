import { describe, expect, it } from "bun:test"

import { registerBtwSideV2 } from "./btw-side-v2"
import { createFakeV2TuiContext } from "./fake-tui-context"
import { createV2TuiFacade } from "./tui-facade"

describe("#given the V2 TUI API without a session_prompt slot or prompt refs", () => {
  it("#when the btw-side registration runs #then it degrades without touching any V2 surface", () => {
    const fake = createFakeV2TuiContext()
    const facade = createV2TuiFacade(fake.ctx)

    registerBtwSideV2()

    expect(fake.slotClaims).toHaveLength(0)
    expect(fake.keymapLayers).toHaveLength(0)
    expect(fake.toasts).toHaveLength(0)
    expect(fake.dialogShows).toHaveLength(0)
    expect(fake.pushedModes).toHaveLength(0)
    expect(facade.directory()).toBe("/fake/project")
  })
})
