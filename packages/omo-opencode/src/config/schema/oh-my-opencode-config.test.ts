import { describe, expect, it } from "bun:test"
import { OhMyOpenCodeConfigSchema } from "./oh-my-opencode-config"

describe("OhMyOpenCodeConfigSchema team_mode", () => {
  it("accepts team_mode when provided", () => {
    // given
    const rawConfig = {
      team_mode: {
        enabled: true,
        max_parallel_members: 2,
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.team_mode).toMatchObject({
        enabled: true,
        max_parallel_members: 2,
      })
    }
  })

  it("allows team_mode omission", () => {
    // given
    const rawConfig = {}

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.team_mode).toBeUndefined()
    }
  })
})

describe("OhMyOpenCodeConfigSchema telemetry", () => {
  it("defaults telemetry to false when omitted", () => {
    // given
    const rawConfig = {}

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.telemetry).toBe(false)
    }
  })

  it("accepts boolean telemetry settings", () => {
    // given
    const enabledConfig = { telemetry: true }
    const disabledConfig = { telemetry: false }

    // when
    const enabledResult = OhMyOpenCodeConfigSchema.safeParse(enabledConfig)
    const disabledResult = OhMyOpenCodeConfigSchema.safeParse(disabledConfig)

    // then
    expect(enabledResult.success).toBe(true)
    expect(disabledResult.success).toBe(true)
    if (enabledResult.success) {
      expect(enabledResult.data.telemetry).toBe(true)
    }
    if (disabledResult.success) {
      expect(disabledResult.data.telemetry).toBe(false)
    }
  })

  it("rejects string telemetry settings", () => {
    // given
    const rawConfig = { telemetry: "yes" }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig)

    // then
    expect(result.success).toBe(false)
  })
})

describe("OhMyOpenCodeConfigSchema remote MCP opt-in fields", () => {
  it("keeps the remote MCP sections optional when omitted", () => {
    // given
    const rawConfig = {}

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.websearch).toBeUndefined()
      expect(result.data.context7).toBeUndefined()
      expect(result.data.grep_app).toBeUndefined()
    }
  })

  it("defaults the remote MCP enabled flags to false for empty sections", () => {
    // given
    const rawConfig = { websearch: {}, context7: {}, grep_app: {} }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.websearch?.enabled).toBe(false)
      expect(result.data.context7?.enabled).toBe(false)
      expect(result.data.grep_app?.enabled).toBe(false)
    }
  })

  it("accepts explicit enabled flags for the remote MCPs", () => {
    // given
    const rawConfig = {
      websearch: { enabled: true, provider: "tavily" },
      context7: { enabled: true },
      grep_app: { enabled: true },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.websearch?.enabled).toBe(true)
      expect(result.data.websearch?.provider).toBe("tavily")
      expect(result.data.context7?.enabled).toBe(true)
      expect(result.data.grep_app?.enabled).toBe(true)
    }
  })
})

describe("OhMyOpenCodeConfigSchema tui", () => {
  it("defaults the TUI sidebar to enabled", () => {
    // given
    const rawConfig = {}

    // when
    const result = OhMyOpenCodeConfigSchema.parse(rawConfig)

    // then
    expect(result.tui?.sidebar.enabled).toBe(true)
  })

  it("allows the TUI sidebar to be disabled", () => {
    // given
    const rawConfig = {
      tui: {
        sidebar: {
          enabled: false,
        },
      },
    }

    // when
    const result = OhMyOpenCodeConfigSchema.parse(rawConfig)

    // then
    expect(result.tui?.sidebar.enabled).toBe(false)
  })
})

describe("OhMyOpenCodeConfigSchema agent_order", () => {
  it("accepts string agent ordering when provided", () => {
    // given
    const rawConfig = {
      agent_order: ["hephaestus", "sisyphus", "prometheus", "atlas"],
    }

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agent_order).toEqual([
        "hephaestus",
        "sisyphus",
        "prometheus",
        "atlas",
      ])
    }
  })

  it("allows agent_order omission", () => {
    // given
    const rawConfig = {}

    // when
    const result = OhMyOpenCodeConfigSchema.safeParse(rawConfig)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.agent_order).toBeUndefined()
    }
  })

  it("rejects abusive agent_order string length and item count", () => {
    // given
    const tooLongName = "x".repeat(129)
    const tooManyNames = Array.from({ length: 65 }, (_, index) => `agent-${index}`)

    // when
    const tooLongResult = OhMyOpenCodeConfigSchema.safeParse({
      agent_order: [tooLongName],
    })
    const tooManyResult = OhMyOpenCodeConfigSchema.safeParse({
      agent_order: tooManyNames,
    })

    // then
    expect(tooLongResult.success).toBe(false)
    expect(tooManyResult.success).toBe(false)
  })
})
