import { describe, expect, it } from "bun:test"

import {
  addPendingEdit,
  pendingEditIds,
  removePendingEdit,
  serializePendingEditDiff,
  serializePendingEditDiffs,
} from "./pending-edits"

const current = (value: unknown) => ({ present: true, value })

function firstOrThrow(edits: readonly PendingEdit[]): PendingEdit {
  const edit = edits[0]
  if (edit === undefined) throw new Error("expected one pending edit")
  return edit
}

describe("addPendingEdit", () => {
  it("#given fresh edits #when a new path is added #then the edit is appended", () => {
    const edits = addPendingEdit([], {
      id: "catalog.enabled",
      path: ["catalog", "enabled"],
      value: false,
      current: { present: false, value: undefined },
      defaultLabel: "(default)",
    })
    expect(edits).toHaveLength(1)
    expect(edits[0]?.id).toBe("catalog.enabled")
    expect(edits[0]?.value).toBe(false)
  })

  it("#given an existing edit on the same path #when a new value is added #then it replaces in place", () => {
    const first = addPendingEdit([], {
      id: "catalog.enabled",
      path: ["catalog", "enabled"],
      value: false,
      current: current(true),
      defaultLabel: "(default)",
    })
    const replaced = addPendingEdit(first, {
      id: "catalog.enabled",
      path: ["catalog", "enabled"],
      value: 3,
      current: current(true),
      defaultLabel: "(default)",
    })
    expect(replaced).toHaveLength(1)
    expect(replaced[0]?.value).toBe(3)
  })

  it("#given edits on different paths #when one is added #then both are kept", () => {
    const first = addPendingEdit([], {
      id: "catalog.enabled",
      path: ["catalog", "enabled"],
      value: false,
      current: current(true),
      defaultLabel: "(default)",
    })
    const both = addPendingEdit(first, {
      id: "comment_checker.enabled",
      path: ["comment_checker", "enabled"],
      value: false,
      current: { present: false, value: undefined },
      defaultLabel: "(default)",
    })
    expect(pendingEditIds(both)).toEqual(["catalog.enabled", "comment_checker.enabled"])
  })

  it("#given the new value equals the current on-disk value #when added #then the pending edit is dropped", () => {
    const first = addPendingEdit([], {
      id: "catalog.enabled",
      path: ["catalog", "enabled"],
      value: false,
      current: current(true),
      defaultLabel: "(default)",
    })
    const dropped = addPendingEdit(first, {
      id: "catalog.enabled",
      path: ["catalog", "enabled"],
      value: true,
      current: current(true),
      defaultLabel: "(default)",
    })
    expect(dropped).toHaveLength(0)
  })

  it("#given the current value is missing #when the value equals the default #then the edit is still kept", () => {
    const edits = addPendingEdit([], {
      id: "catalog.enabled",
      path: ["catalog", "enabled"],
      value: true,
      current: { present: false, value: undefined },
      defaultLabel: "(default)",
    })
    expect(edits).toHaveLength(1)
    expect(edits[0]?.currentLabel).toBe("(default)")
  })
})

describe("removePendingEdit", () => {
  it("#given an edit with the id #when removed #then only that edit is gone", () => {
    const base = addPendingEdit([], {
      id: "a.b",
      path: ["a", "b"],
      value: 1,
      current: { present: false, value: undefined },
      defaultLabel: "(default)",
    })
    const list = addPendingEdit(base, {
      id: "c.d",
      path: ["c", "d"],
      value: 2,
      current: { present: false, value: undefined },
      defaultLabel: "(default)",
    })
    const removed = removePendingEdit(list, "a.b")
    expect(pendingEditIds(removed)).toEqual(["c.d"])
  })
})

describe("serializePendingEditDiff", () => {
  it("#given a present current value #when serialized #then it renders current -> new", () => {
    const edit = firstOrThrow(addPendingEdit([], {
      id: "local_translator.mode",
      path: ["local_translator", "mode"],
      value: "local",
      current: current("cloud"),
      defaultLabel: "(default)",
    }))
    expect(serializePendingEditDiff(edit)).toBe("local_translator.mode: cloud -> local")
  })

  it("#given a missing current value #when serialized #then it renders the fallback label", () => {
    const edit = firstOrThrow(addPendingEdit([], {
      id: "catalog.enabled",
      path: ["catalog", "enabled"],
      value: true,
      current: { present: false, value: undefined },
      defaultLabel: "(default)",
    }))
    expect(serializePendingEditDiff(edit)).toBe("catalog.enabled: (default) -> true")
  })

  it("#given multiple edits #when serialized as a batch #then order matches insertion", () => {
    const base = addPendingEdit([], {
      id: "a.b",
      path: ["a", "b"],
      value: false,
      current: current(true),
      defaultLabel: "(default)",
    })
    const list = addPendingEdit(base, {
      id: "c.d",
      path: ["c", "d"],
      value: 7,
      current: { present: false, value: undefined },
      defaultLabel: "(default)",
    })
    expect(serializePendingEditDiffs(list)).toEqual([
      "a.b: true -> false",
      "c.d: (default) -> 7",
    ])
  })
})
