import { describe, expect, it } from "bun:test"

import { matchesIgnorePath } from "./path-ignore"

describe("matchesIgnorePath", () => {
  it("#given a single-segment star pattern #when path matches within a segment #then it returns true", () => {
    expect(matchesIgnorePath("src/app.ts", ["*.ts"])).toBe(false)
    expect(matchesIgnorePath("app.ts", ["*.ts"])).toBe(true)
  })

  it("#given a double-star pattern #when path matches across segments #then it returns true", () => {
    expect(matchesIgnorePath("docs/readme.md", ["**/*.md"])).toBe(true)
    expect(matchesIgnorePath("docs/sub/readme.md", ["**/*.md"])).toBe(true)
    expect(matchesIgnorePath("src/app.ts", ["**/*.md"])).toBe(false)
  })

  it("#given an exact pattern #when path equals or ends with it #then it matches exactly", () => {
    expect(matchesIgnorePath("src/app.ts", ["src/app.ts"])).toBe(true)
    expect(matchesIgnorePath("/abs/src/app.ts", ["src/app.ts"])).toBe(true)
    expect(matchesIgnorePath("src/other.ts", ["src/app.ts"])).toBe(false)
  })

  it("#given a directory prefix pattern #when path is under it #then it returns true", () => {
    expect(matchesIgnorePath("docs/readme.md", ["docs/**"])).toBe(true)
    expect(matchesIgnorePath("src/app.ts", ["docs/**"])).toBe(false)
  })

  it("#given no patterns #when any path is checked #then it returns false", () => {
    expect(matchesIgnorePath("src/app.ts", [])).toBe(false)
  })
})
