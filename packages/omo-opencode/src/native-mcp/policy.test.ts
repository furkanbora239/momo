// MODIFIED: project-scoped native MCP policy resolution.
import { describe, expect, test } from "bun:test"
import { resolveMcpPolicy } from "./policy"

describe("native MCP policy", () => {
  test("defaults native search to always, graph to off and other servers to on demand", () => {
    for (const server of ["momo_lsp", "momo_ast_grep"]) expect(resolveMcpPolicy({ server })).toEqual({ mode: "always" })
    for (const server of ["codegraph", "codebase-memory-mcp"]) {
      expect(resolveMcpPolicy({ server })).toEqual({ mode: "off", blockedReason: "policy_off" })
    }
    expect(resolveMcpPolicy({ server: "appwrite" })).toEqual({ mode: "on-demand" })
  })

  test("applies explicit per-server modes", () => {
    expect(resolveMcpPolicy({ server: "appwrite", modes: { appwrite: "always" } })).toEqual({ mode: "always" })
    expect(resolveMcpPolicy({ server: "momo_lsp", modes: { momo_lsp: "off" } })).toEqual({ mode: "off", blockedReason: "policy_off" })
    expect(resolveMcpPolicy({ server: "codegraph", modes: { codegraph: "on-demand" } })).toEqual({ mode: "on-demand" })
  })

  test("hard disables cannot be bypassed by an always policy", () => {
    expect(resolveMcpPolicy({ server: "appwrite", modes: { appwrite: "always" }, disabledMcps: ["appwrite"] }))
      .toEqual({ mode: "off", blockedReason: "disabled_mcp" })
    expect(resolveMcpPolicy({ server: "appwrite", modes: { appwrite: "always" }, upstreamDisabled: true }))
      .toEqual({ mode: "off", blockedReason: "upstream_disabled" })
    expect(resolveMcpPolicy({ server: "appwrite", disabledMcps: ["unrelated"] })).toEqual({ mode: "on-demand" })
  })

  test("does not read inherited properties as policy overrides", () => {
    const modes = Object.create({ appwrite: "always" })
    expect(resolveMcpPolicy({ server: "appwrite", modes })).toEqual({ mode: "on-demand" })
  })
})
