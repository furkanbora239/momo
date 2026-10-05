import { describe, expect, it } from "bun:test"
import { createSessionStatusRegistry } from "./session-status-registry"

describe("createSessionStatusRegistry", () => {
  it("records an idle status via feed and returns it through get", () => {
    // given
    const registry = createSessionStatusRegistry()

    // when
    registry.feed("session.idle", "ses-1")

    // then
    expect(registry.get("ses-1")).toEqual({ type: "idle" })
  })

  it("records a busy status from a session.status event via feed", () => {
    // given
    const registry = createSessionStatusRegistry()

    // when
    registry.feed("session.status", "ses-2", { status: "busy" })

    // then
    expect(registry.get("ses-2")).toEqual({ type: "busy" })
  })

  it("prunes a session on delete and drops it from get", () => {
    // given
    const registry = createSessionStatusRegistry()
    registry.feed("session.created", "ses-3")
    expect(registry.get("ses-3")).toEqual({ type: "alive" })

    // when
    registry.feed("session.deleted", "ses-3")

    // then
    expect(registry.get("ses-3")).toBeUndefined()
  })

  it("surfaces every tracked session through map", () => {
    // given
    const registry = createSessionStatusRegistry()
    registry.feed("session.idle", "ses-1")
    registry.feed("session.status", "ses-2", { status: "busy" })

    // when
    const snapshot = registry.map()

    // then
    expect(snapshot).toEqual({
      "ses-1": { type: "idle" },
      "ses-2": { type: "busy" },
    })
  })

  it("lets a later status override an earlier one for the same session", () => {
    // given
    const registry = createSessionStatusRegistry()
    registry.feed("session.created", "ses-4")

    // when
    registry.feed("session.status", "ses-4", { status: "retry" })

    // then
    expect(registry.get("ses-4")).toEqual({ type: "retry" })
    expect(registry.map()).toEqual({ "ses-4": { type: "retry" } })
  })

  it("clears all tracked sessions", () => {
    // given
    const registry = createSessionStatusRegistry()
    registry.feed("session.idle", "ses-1")
    registry.feed("session.status", "ses-2", { status: "busy" })

    // when
    registry.clear()

    // then
    expect(registry.get("ses-1")).toBeUndefined()
    expect(registry.get("ses-2")).toBeUndefined()
    expect(registry.map()).toEqual({})
  })

  it("ignores unknown event kinds that carry no explicit status", () => {
    // given
    const registry = createSessionStatusRegistry()

    // when
    registry.feed("filesystem.changed", "ses-9")

    // then
    expect(registry.get("ses-9")).toBeUndefined()
  })
})
