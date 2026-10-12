import { readFile } from "node:fs/promises"
import { describe, expect, test } from "bun:test"

const DIST_INDEX = "dist/index.js"

describe("native agent bundle assets", () => {
  test("the published bundle contains owned agent definitions and native frontmatter", async () => {
    const bundle = Bun.file(DIST_INDEX)
    expect(await bundle.exists(), `${DIST_INDEX} must exist before this CI-only test runs`).toBe(true)
    const source = await readFile(DIST_INDEX, "utf8")

    expect(source).toContain("momo-native-agent-owned:v1")
    expect(source).toContain("momo-orchestrator")
    expect(source).toContain("momo-planner")
    expect(source).toContain("mode: primary")
    expect(source).toContain("mode: subagent")
  })
})
