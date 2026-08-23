import { describe, expect, spyOn, test } from "bun:test"
import { checkMomORoster } from "./momo"
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
})
