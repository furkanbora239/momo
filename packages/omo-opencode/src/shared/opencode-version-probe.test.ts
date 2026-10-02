import { describe, expect, it } from "bun:test"

import {
  createOpenCodeVersionProbe,
  isOpenCodeV2,
  majorFromVersion,
} from "./opencode-version-probe"

describe("majorFromVersion", () => {
  it("#given a plain semver string #when parsing #then it returns the major segment", () => {
    expect(majorFromVersion("1.18.34")).toBe(1)
    expect(majorFromVersion("2.0.0")).toBe(2)
    expect(majorFromVersion("10.1.2")).toBe(10)
  })

  it("#given raw opencode --version output #when parsing #then it extracts the leading major", () => {
    expect(majorFromVersion("opencode 2.1.0-beta.3 (ce0f1a2)")).toBe(2)
    expect(majorFromVersion("v2.0.0")).toBe(2)
    expect(majorFromVersion("  1.18.34\n")).toBe(1)
  })

  it("#given null or unparseable output #when parsing #then it returns null so callers fall back to V1", () => {
    expect(majorFromVersion(null)).toBeNull()
    expect(majorFromVersion("")).toBeNull()
    expect(majorFromVersion("not-a-version")).toBeNull()
  })
})

describe("isOpenCodeV2", () => {
  it("#given major numbers #when checking #then only majors of two or higher count as V2", () => {
    expect(isOpenCodeV2(1)).toBe(false)
    expect(isOpenCodeV2(2)).toBe(true)
    expect(isOpenCodeV2(3)).toBe(true)
    expect(isOpenCodeV2(null)).toBe(false)
  })
})

describe("createOpenCodeVersionProbe", () => {
  it("#given a fake opencode --version result #when probing #then it reports version and major", () => {
    const probe = createOpenCodeVersionProbe({ version: () => "1.18.34" })

    expect(probe()).toEqual({ available: true, version: "1.18.34", major: 1 })
  })

  it("#given a V2 version banner #when probing #then it detects the V2 major", () => {
    const probe = createOpenCodeVersionProbe({ version: () => "opencode 2.0.1 (ce0f1a2)" })

    expect(probe()).toEqual({ available: true, version: "opencode 2.0.1 (ce0f1a2)", major: 2 })
  })

  it("#given no detectable version #when probing #then it reports unavailable so callers stay on the V1 path", () => {
    const probe = createOpenCodeVersionProbe({ version: () => null })

    expect(probe()).toEqual({ available: false, version: null, major: null })
  })

  it("#given repeated calls #when probing #then the version source is consulted once per probe instance", () => {
    let calls = 0
    const probe = createOpenCodeVersionProbe({
      version: () => {
        calls += 1
        return "1.18.34"
      },
    })

    const first = probe()
    const second = probe()

    expect(first).toEqual(second)
    expect(calls).toBe(1)
  })
})
