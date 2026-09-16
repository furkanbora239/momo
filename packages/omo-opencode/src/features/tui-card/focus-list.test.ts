import { describe, expect, it } from "bun:test"

import { clampFocus, createFocusList, moveFocus } from "./focus-list"

describe("clampFocus", () => {
  it("#given a negative index #when clamping #then it returns zero", () => {
    expect(clampFocus(-3, 5)).toBe(0)
  })

  it("#given an index past the end #when clamping #then it returns the last index", () => {
    expect(clampFocus(9, 5)).toBe(4)
  })

  it("#given an empty list #when clamping #then it returns zero", () => {
    expect(clampFocus(2, 0)).toBe(0)
  })

  it("#given an in-range index #when clamping #then it returns it unchanged", () => {
    expect(clampFocus(2, 5)).toBe(2)
  })
})

describe("moveFocus", () => {
  it("#given a delta past the top #when moving #then it clamps at zero", () => {
    const next = moveFocus({ index: 1, count: 5 }, -5)
    expect(next.index).toBe(0)
  })

  it("#given a delta past the bottom #when moving #then it clamps at the last index", () => {
    const next = moveFocus({ index: 3, count: 5 }, 10)
    expect(next.index).toBe(4)
  })

  it("#given an in-range delta #when moving #then it shifts by the delta", () => {
    const next = moveFocus({ index: 2, count: 5 }, 1)
    expect(next.index).toBe(3)
  })
})

describe("createFocusList", () => {
  it("#given a move within bounds #when moving #then it reports a change", () => {
    const list = createFocusList(5)
    expect(list.move(2)).toBe(true)
    expect(list.current()).toBe(2)
  })

  it("#given a move at the top boundary #when moving up #then it reports no change", () => {
    const list = createFocusList(5)
    expect(list.move(-1)).toBe(false)
    expect(list.current()).toBe(0)
  })

  it("#given a move at the bottom boundary #when moving down #then it reports no change", () => {
    const list = createFocusList(5)
    list.move(10)
    expect(list.current()).toBe(4)
    expect(list.move(1)).toBe(false)
  })

  it("#given a shrinking count #when reseating #then the index clamps into range", () => {
    const list = createFocusList(5)
    list.move(4)
    list.reseat(2)
    expect(list.current()).toBe(1)
  })

  it("#given a moved index #when resetting #then it returns to the first card", () => {
    const list = createFocusList(5)
    list.move(3)
    list.reset()
    expect(list.current()).toBe(0)
  })

  it("#given an empty list #when resetting #then it stays at zero", () => {
    const list = createFocusList(0)
    list.reset()
    expect(list.current()).toBe(0)
  })

  it("#given a target index #when seeking #then it clamps into range", () => {
    const list = createFocusList(3)
    list.seek(9)
    expect(list.current()).toBe(2)
    list.seek(-4)
    expect(list.current()).toBe(0)
  })

  it("#given an empty list #when moving #then it reports no change", () => {
    const list = createFocusList(0)
    expect(list.move(1)).toBe(false)
    expect(list.current()).toBe(0)
  })
})
