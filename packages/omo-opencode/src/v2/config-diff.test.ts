import { describe, expect, it } from "bun:test"
import { deepEqual, diffRecordKeys } from "./config-diff"

describe("#given plain primitive values", () => {
  it("#when deepEqual is called then Object.is semantics apply", () => {
    expect(deepEqual(1, 1)).toBe(true)
    expect(deepEqual("a", "a")).toBe(true)
    expect(deepEqual(NaN, NaN)).toBe(true)
    expect(deepEqual(1, 2)).toBe(false)
    expect(deepEqual(null, undefined)).toBe(false)
  })
})

describe("#given nested records and arrays", () => {
  it("#when deepEqual is called then structure compares recursively", () => {
    expect(deepEqual({ a: [1, { b: "x" }] }, { a: [1, { b: "x" }] })).toBe(true)
    expect(deepEqual({ a: [1, { b: "x" }] }, { a: [1, { b: "y" }] })).toBe(false)
    expect(deepEqual({ a: [1, 2] }, { a: [1, 2, 3] })).toBe(false)
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true)
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false)
  })
})

describe("#given two config maps", () => {
  it("#when diffRecordKeys is called then added, changed, and removed keys are reported", () => {
    const diff = diffRecordKeys(
      { kept: { same: 1 }, changed: { old: 1 }, removed: { gone: 1 } },
      { kept: { same: 1 }, changed: { new: 2 }, added: { fresh: 3 } },
    )
    expect(diff.added).toEqual(["added"])
    expect(diff.changed).toEqual(["changed"])
    expect(diff.removed).toEqual(["removed"])
  })

  it("#when a key only exists with an undefined value then it counts as absent", () => {
    const diff = diffRecordKeys({ ghost: undefined }, { real: 1 })
    expect(diff.added).toEqual(["real"])
    expect(diff.removed).toEqual([])
  })
})
