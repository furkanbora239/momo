declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")

import { DEFAULT_STALE_TIMEOUT_MS } from "./constants"

describe("DEFAULT_STALE_TIMEOUT_MS", () => {
  test("uses a 3 minute default for stall detection", () => {
    // #given
    const expectedTimeout = 3 * 60 * 1000

    // #when
    const timeout = DEFAULT_STALE_TIMEOUT_MS

    // #then
    expect(timeout).toBe(expectedTimeout)
  })
})
