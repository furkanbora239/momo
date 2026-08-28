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
