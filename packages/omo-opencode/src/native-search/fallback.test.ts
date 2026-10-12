import { describe, expect, test } from "bun:test"
import { createNativeSearchFallbackConfigs, nativeSearchToolsForRole, NATIVE_SEARCH_READ_TOOLS, NATIVE_SEARCH_WRITE_TOOLS } from "./fallback"
import { LSP_MCP_TOOLS } from "@oh-my-opencode/lsp-core/tools"
import { handleLspMcpRequest } from "@oh-my-opencode/lsp-core/mcp"
import { AST_GREP_MCP_TOOLS } from "../../../ast-grep-mcp/src/mcp"
import { handleAstGrepMcpRequest } from "../../../ast-grep-mcp/src/mcp"

function toolNames(response: unknown): string[] {
  if (typeof response !== "object" || response === null || !("result" in response)) throw new Error("MCP tools/list did not return a result")
  const result = response.result
  if (typeof result !== "object" || result === null || !("tools" in result) || !Array.isArray(result.tools)) {
    throw new Error("MCP tools/list returned malformed tools")
  }
  return result.tools.flatMap((tool) => typeof tool === "object" && tool !== null && "name" in tool && typeof tool.name === "string" ? [tool.name] : [])
}

describe("native search fallback wiring", () => {
  test("produces direct V2 MCP server configs for LSP and ast-grep", () => {
    const configs = createNativeSearchFallbackConfigs({
      cwd: "/workspace/project",
      astGrepCommand: ["node", "/managed/ast-grep/cli.js", "mcp"],
      lspCommand: ["node", "/managed/lsp/cli.js", "mcp"],
      homeDirectory: "/managed/home",
    })

    expect(configs.momo_lsp).toEqual({
      type: "local",
      command: ["node", "/managed/lsp/cli.js", "mcp"],
      cwd: "/workspace/project",
      environment: {
        LSP_TOOLS_MCP_PROJECT_CONFIG: [".opencode/lsp.json", ".omo/lsp.json", ".omo/lsp-client.json"]
          .map((path) => `/workspace/project/${path}`).join(process.platform === "win32" ? ";" : ":"),
        LSP_TOOLS_MCP_USER_CONFIG: "/managed/home/.omo/native/lsp.json",
        LSP_TOOLS_MCP_INSTALL_DECISIONS: "/managed/home/.omo/native/lsp-install-decisions.json",
      },
      disabled: false,
    })
    expect(configs.momo_ast_grep).toEqual({
      type: "local", command: ["node", "/managed/ast-grep/cli.js", "mcp"], cwd: "/workspace/project", disabled: false,
    })
  })

  test("does not enable an absent ast-grep runtime and limits writes to execution roles", () => {
    const configs = createNativeSearchFallbackConfigs({ cwd: "/workspace/project", exists: () => false })
    expect(configs.momo_ast_grep.disabled).toBe(true)
    expect(nativeSearchToolsForRole("orchestrator")).toEqual(NATIVE_SEARCH_READ_TOOLS)
    expect(nativeSearchToolsForRole("executor")).toEqual(NATIVE_SEARCH_READ_TOOLS)
    expect(nativeSearchToolsForRole("advisor")).toEqual(NATIVE_SEARCH_READ_TOOLS)
    expect(nativeSearchToolsForRole("catalog-researcher")).toEqual(NATIVE_SEARCH_READ_TOOLS)
    expect(nativeSearchToolsForRole("worker")).toEqual([...NATIVE_SEARCH_READ_TOOLS, ...NATIVE_SEARCH_WRITE_TOOLS])
  })

  test("finds package executables from a bundled plugin path without assuming source layout", () => {
    const lspCLI = "/virtual/momo/packages/lsp-tools-mcp/dist/cli.js"
    const astCLI = "/virtual/momo/packages/ast-grep-mcp/dist/cli.js"
    const configs = createNativeSearchFallbackConfigs({
      cwd: "/workspace/project",
      moduleUrl: "file:///virtual/momo/packages/omo-opencode/dist/index.js",
      exists: (path) => path === lspCLI || path === astCLI,
    })

    expect(configs.momo_lsp.command.at(-2)).toBe(lspCLI)
    expect(configs.momo_lsp.disabled).toBe(false)
    expect(configs.momo_ast_grep.command.at(-2)).toBe(astCLI)
    expect(configs.momo_ast_grep.disabled).toBe(false)
  })

  test("uses only tool IDs published by the real LSP and ast-grep MCP schemas", () => {
    const published = new Set([
      ...LSP_MCP_TOOLS.map((tool) => `mcp__momo_lsp__${tool.name}`),
      ...AST_GREP_MCP_TOOLS.map((tool) => `mcp__momo_ast_grep__${tool.name}`),
    ])
    expect(NATIVE_SEARCH_READ_TOOLS.every((tool) => published.has(tool))).toBe(true)
    expect(NATIVE_SEARCH_WRITE_TOOLS.every((tool) => published.has(tool))).toBe(true)
  })

  test("matches the actual native MCP tools/list responses", async () => {
    const [lspResponse, astGrepResponse] = await Promise.all([
      handleLspMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      handleAstGrepMcpRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    ])
    const actual = new Set([
      ...toolNames(lspResponse).map((name) => `mcp__momo_lsp__${name}`),
      ...toolNames(astGrepResponse).map((name) => `mcp__momo_ast_grep__${name}`),
    ])
    expect(NATIVE_SEARCH_READ_TOOLS.every((tool) => actual.has(tool))).toBe(true)
    expect(NATIVE_SEARCH_WRITE_TOOLS.every((tool) => actual.has(tool))).toBe(true)
  })
})
