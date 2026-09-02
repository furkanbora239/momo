import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, spyOn, test } from "bun:test"
import { checkMomORoster, collectStaleDistIssue } from "./momo"
import * as validate from "../../../config/validate"

function mockConfig(config: Record<string, unknown>): void {
  spyOn(validate, "validatePluginConfig").mockReturnValue({
    config: config as never,
    messages: [],
  })
}

describe("momo doctor check", () => {
  test("reports catalog enabled and advisor unbound by default", async () => {
    mockConfig({})
    const result = await checkMomORoster()
    expect(result.name).toBe("momo Roster & Catalog")
    expect(result.message).toContain("catalog on")
    expect(result.message).toContain("advisor unbound")
  })

  test("reports advisor bound when configured", async () => {
    mockConfig({ agents: { advisor: { model: "anthropic/claude-opus-5" } } })
    const result = await checkMomORoster()
    expect(result.message).toContain("advisor bound")
  })

  test("reports repo map disabled when not configured", async () => {
    mockConfig({})
    const result = await checkMomORoster()
    expect(result.details.some((detail) => detail.includes("repo map injector: disabled"))).toBe(true)
  })

  test("reports repo map enabled with budget when configured", async () => {
    mockConfig({ repo_map: { enabled: true, token_budget: 512 } })
    const result = await checkMomORoster()
    expect(result.details.some((detail) => detail.includes("repo map injector: enabled (token budget 512)"))).toBe(true)
  })
})

describe("collectStaleDistIssue", () => {
  test("flags src newer than dist as a stale bundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "momo-stale-"))
    try {
      const dist = join(dir, "index.js")
      const src = join(dir, "index.ts")
      writeFileSync(dist, "bundle")
      writeFileSync(src, "source")
      const past = new Date(Date.now() - 60_000)
      utimesSync(dist, past, past)
      const issue = collectStaleDistIssue(dist, src)
      expect(issue?.title).toContain("stale dist bundle")
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test("returns undefined when dist is fresh or paths are missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "momo-fresh-"))
    try {
      const dist = join(dir, "index.js")
      const src = join(dir, "index.ts")
      writeFileSync(dist, "bundle")
      writeFileSync(src, "source")
      const past = new Date(Date.now() - 60_000)
      utimesSync(src, past, past)
      expect(collectStaleDistIssue(dist, src)).toBeUndefined()
      expect(collectStaleDistIssue(join(dir, "missing.js"), src)).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
