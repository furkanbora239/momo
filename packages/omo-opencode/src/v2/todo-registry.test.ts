import { describe, expect, it } from "bun:test"
import { createTodoRegistry, toTodoItems } from "./todo-registry"

describe("createTodoRegistry", () => {
  it("records a todo snapshot via feed and returns it through get", () => {
    // given
    const registry = createTodoRegistry()

    // when
    registry.feed("todo.updated", "ses-1", {
      todos: [{ content: "write tests", status: "in_progress", priority: "high" }],
    })

    // then
    expect(registry.get("ses-1")).toEqual([
      { content: "write tests", status: "in_progress", priority: "high" },
    ])
  })

  it("replaces the stored snapshot on a later update for the same session", () => {
    // given
    const registry = createTodoRegistry()
    registry.feed("todo.updated", "ses-2", { todos: [{ content: "first", status: "pending" }] })

    // when
    registry.feed("todo.updated", "ses-2", {
      todos: [{ content: "first", status: "completed" }, { content: "second", status: "pending" }],
    })

    // then
    expect(registry.get("ses-2")).toEqual([
      { content: "first", status: "completed" },
      { content: "second", status: "pending" },
    ])
  })

  it("prunes a session on delete and drops it from get", () => {
    // given
    const registry = createTodoRegistry()
    registry.feed("todo.updated", "ses-3", { todos: [{ content: "a", status: "pending" }] })
    expect(registry.get("ses-3")).toEqual([{ content: "a", status: "pending" }])

    // when
    registry.feed("session.deleted", "ses-3")

    // then
    expect(registry.get("ses-3")).toBeUndefined()
  })

  it("surfaces every tracked session through map", () => {
    // given
    const registry = createTodoRegistry()
    registry.feed("todo.updated", "ses-1", { todos: [{ content: "a", status: "pending" }] })
    registry.feed("todo.updated", "ses-2", { todos: [{ content: "b", status: "completed" }] })

    // when
    const snapshot = registry.map()

    // then
    expect(snapshot).toEqual({
      "ses-1": [{ content: "a", status: "pending" }],
      "ses-2": [{ content: "b", status: "completed" }],
    })
  })

  it("clears all tracked sessions", () => {
    // given
    const registry = createTodoRegistry()
    registry.feed("todo.updated", "ses-1", { todos: [{ content: "a", status: "pending" }] })
    registry.feed("todo.updated", "ses-2", { todos: [{ content: "b", status: "completed" }] })

    // when
    registry.clear()

    // then
    expect(registry.get("ses-1")).toBeUndefined()
    expect(registry.get("ses-2")).toBeUndefined()
    expect(registry.map()).toEqual({})
  })

  it("ignores unknown event kinds and updates without a todo payload", () => {
    // given
    const registry = createTodoRegistry()

    // when
    registry.feed("filesystem.changed", "ses-9")
    registry.feed("todo.updated", "ses-9")

    // then
    expect(registry.get("ses-9")).toBeUndefined()
  })

  it("returns copies so callers cannot mutate the stored snapshot", () => {
    // given
    const registry = createTodoRegistry()
    registry.feed("todo.updated", "ses-1", { todos: [{ content: "a", status: "pending" }] })

    // when
    const returned = registry.get("ses-1")
    returned?.push({ content: "injected", status: "pending" })

    // then
    expect(registry.get("ses-1")).toEqual([{ content: "a", status: "pending" }])
  })
})

describe("toTodoItems", () => {
  it("returns undefined when the payload is not an array", () => {
    // given + when + then
    expect(toTodoItems(undefined)).toBeUndefined()
    expect(toTodoItems({ content: "a" })).toBeUndefined()
  })

  it("drops malformed entries and keeps the well-formed ones", () => {
    // given
    const payload = [
      { content: "keep", status: "pending", id: "t-1", priority: "low" },
      { content: 42, status: "pending" },
      { status: "completed" },
      null,
      "nope",
    ]

    // when
    const items = toTodoItems(payload)

    // then
    expect(items).toEqual([{ id: "t-1", content: "keep", status: "pending", priority: "low" }])
  })
})
