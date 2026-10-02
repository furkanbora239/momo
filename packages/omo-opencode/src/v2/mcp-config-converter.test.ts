import { describe, expect, it } from "bun:test"
import {
  convertV1McpEntry,
  convertV2McpServerToV1Seed,
  mcpSeedEntryChanged,
} from "./mcp-config-converter"

describe("#given a V1 local mcp entry", () => {
  it("#when convertV1McpEntry is called then command, environment, and cwd carry over", () => {
    const config = convertV1McpEntry({
      type: "local",
      command: ["bun", "x", "fixture-mcp"],
      environment: { FIXTURE_VAR: "1" },
      enabled: true,
    })
    expect(config).toEqual({
      type: "local",
      command: ["bun", "x", "fixture-mcp"],
      environment: { FIXTURE_VAR: "1" },
      disabled: false,
    })
  })

  it("#when enabled is false then the V2 disabled flag is the inverse", () => {
    const config = convertV1McpEntry({
      type: "local",
      command: ["bun", "x", "fixture-mcp"],
      enabled: false,
    })
    expect(config).toEqual({
      type: "local",
      command: ["bun", "x", "fixture-mcp"],
      disabled: true,
    })
  })

  it("#when command is a single string then it is normalized to an array", () => {
    const config = convertV1McpEntry({
      type: "local",
      command: "fixture-mcp" as never,
      enabled: true,
    })
    expect(config).toEqual({ type: "local", command: ["fixture-mcp"], disabled: false })
  })

  it("#when a flat timeout is set then it lands on the catalog timeout", () => {
    const config = convertV1McpEntry({
      type: "local",
      command: ["bun", "x", "fixture-mcp"],
      timeout: 2500,
    })
    expect(config).toEqual({
      type: "local",
      command: ["bun", "x", "fixture-mcp"],
      timeout: { catalog: 2500 },
      disabled: false,
    })
  })
})

describe("#given a V1 remote mcp entry", () => {
  it("#when convertV1McpEntry is called then url and headers carry over", () => {
    const config = convertV1McpEntry({
      type: "remote",
      url: "https://fixture.example/mcp",
      headers: { "X-Fixture": "1" },
      enabled: false,
    })
    expect(config).toEqual({
      type: "remote",
      url: "https://fixture.example/mcp",
      headers: { "X-Fixture": "1" },
      disabled: true,
    })
  })

  it("#when oauth is false or a config object then the V2 oauth shape matches", () => {
    expect(convertV1McpEntry({ type: "remote", url: "u", oauth: false })).toEqual({
      type: "remote",
      url: "u",
      oauth: false,
      disabled: false,
    })
    expect(
      convertV1McpEntry({
        type: "remote",
        url: "u",
        oauth: { clientId: "id-1", clientSecret: "secret-1", scope: "read" },
      }),
    ).toEqual({
      type: "remote",
      url: "u",
      oauth: { client_id: "id-1", client_secret: "secret-1", scope: "read" },
      disabled: false,
    })
  })
})

describe("#given a V2 mcp list server", () => {
  it("#when convertV2McpServerToV1Seed is called then only the enabled state is derivable", () => {
    expect(convertV2McpServerToV1Seed({ status: { status: "connected" } })).toEqual({ enabled: true })
    expect(convertV2McpServerToV1Seed({ status: { status: "disabled" } })).toEqual({ enabled: false })
    expect(convertV2McpServerToV1Seed({ status: { status: "failed" } })).toEqual({ enabled: true })
  })
})

describe("#given a seed entry and a post-handler entry", () => {
  it("#when mcpSeedEntryChanged is called then only the enabled flip counts as a change", () => {
    expect(mcpSeedEntryChanged({ enabled: true }, { type: "local", command: ["x"], enabled: true })).toBe(false)
    expect(mcpSeedEntryChanged({ enabled: true }, { type: "local", command: ["x"], enabled: false })).toBe(true)
    expect(mcpSeedEntryChanged({ enabled: false }, { type: "remote", url: "u", enabled: false })).toBe(false)
  })
})
