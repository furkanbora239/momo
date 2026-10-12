import { describe, expect, test } from "bun:test"
import {
  filterNativeContextTools,
  isNativeReadTool,
  nativeActionEffect,
  nativeAgentPermissions,
  nativeToolAllowed,
  normalizeNativeSearchToolName,
  ownedAgentID,
} from "./role-policy"

describe("native momo role policy", () => {
  test("coordinators can create tasks while only execution roles can use shell/edit", () => {
    expect(nativeToolAllowed("momo-orchestrator", "momo_task")).toBe(true)
    expect(nativeAgentPermissions("momo-orchestrator").find((rule) => rule.action === "shell")?.effect).toBe("deny")
    expect(nativeAgentPermissions("momo-orchestrator").find((rule) => rule.action === "momo_catalog_enrich")?.effect).toBe("deny")
    expect(nativeAgentPermissions("momo-catalog-researcher").find((rule) => rule.action === "momo_catalog_enrich")?.effect).toBe("allow")
    expect(nativeAgentPermissions("momo-worker").find((rule) => rule.action === "shell")?.effect).toBe("allow")
    expect(nativeAgentPermissions("momo-worker").find((rule) => rule.action === "task")?.effect).toBe("deny")
  })

  test("advisor is read-only and cannot create tasks or consult itself", () => {
    expect(nativeToolAllowed("momo-advisor", "momo_task")).toBe(false)
    expect(nativeToolAllowed("momo-advisor", "momo_consult")).toBe(false)
    expect(nativeAgentPermissions("momo-advisor").find((rule) => rule.action === "edit")?.effect).toBe("deny")
  })

  test("unowned momo-prefixed agents are not mapped into the native role surface", () => {
    expect(ownedAgentID("momo-orchestrator")).toBe("momo-orchestrator")
    expect(ownedAgentID("momo-user-agent")).toBeUndefined()
  })

  test("context filtering hides write and subagent tools from coordinator and advisor roles", () => {
    const coordinatorTools: Record<string, unknown> = { read: {}, shell: {}, lsp_rename: {}, momo_task: {}, momo_consult: {}, momo_catalog_enrich: {}, momo_task_select: {}, momo_task_resume: {}, momo_task_cancel: {}, task: {}, catalog_list: {} }
    filterNativeContextTools("momo-orchestrator", coordinatorTools)
    expect(Object.keys(coordinatorTools).sort()).toEqual(["catalog_list", "momo_consult", "momo_task", "read"])
    const advisorTools: Record<string, unknown> = { execute: {}, read: {}, edit: {}, momo_task: {}, momo_consult: {}, webfetch: {} }
    filterNativeContextTools("momo-advisor", advisorTools)
    expect(Object.keys(advisorTools).sort()).toEqual(["execute", "read", "webfetch"])
    expect(nativeActionEffect("momo-advisor", "execute")).toBeUndefined()
    expect(nativeActionEffect("momo-worker", "task")).toBe("deny")
    expect(nativeActionEffect("momo-worker", "momo_task")).toBe("deny")
    expect(nativeActionEffect("momo-orchestrator", "momo_task_cancel")).toBe("deny")
  })

  test("same-name unowned agent conflicts do not inherit native role filtering", () => {
    const tools: Record<string, unknown> = { read: {}, shell: {}, momo_task: {}, task: {} }
    filterNativeContextTools("momo-orchestrator", tools, new Set())
    expect(Object.keys(tools).sort()).toEqual(["momo_task", "read", "shell", "task"])
  })
})

describe("native Code Mode MCP tool names", () => {
  test("normalizes actual OpenCode MCP IDs to the narrow configured tool allowlist", () => {
    expect(normalizeNativeSearchToolName("momo_lsp_status")).toBe("mcp__momo_lsp__status")
    expect(normalizeNativeSearchToolName("momo_ast_grep_search")).toBe("mcp__momo_ast_grep__search")
    expect(normalizeNativeSearchToolName("momo_lsp.rename")).toBe("mcp__momo_lsp__rename")
    expect(normalizeNativeSearchToolName("momo_lsp_unknown")).toBe("mcp__momo_lsp__unknown")
    expect(isNativeReadTool("momo_lsp_status")).toBe(true)
    expect(isNativeReadTool("momo_ast_grep_search")).toBe(true)
    expect(isNativeReadTool("momo_lsp_rename")).toBe(false)
  })

  test("allows advisor read fallback but rejects MCP writes and allows worker writes", () => {
    expect(nativeActionEffect("momo-advisor", "momo_lsp_status")).toBeUndefined()
    expect(nativeActionEffect("momo-advisor", "momo_ast_grep_search")).toBeUndefined()
    expect(nativeActionEffect("momo-advisor", "momo_lsp_rename")).toBe("deny")
    expect(nativeActionEffect("momo-advisor", "momo_ast_grep_rewrite")).toBe("deny")
    expect(nativeActionEffect("momo-orchestrator", "momo_lsp_rename")).toBe("deny")
    expect(nativeActionEffect("momo-worker", "momo_lsp_rename")).toBeUndefined()
    expect(nativeActionEffect("momo-worker", "momo_ast_grep_rewrite")).toBeUndefined()
  })

  test("filters nested MCP tools using the same role allowlist", () => {
    const advisorTools: Record<string, unknown> = {
      momo_lsp_status: {}, momo_ast_grep_search: {}, momo_lsp_rename: {}, momo_ast_grep_rewrite: {},
    }
    filterNativeContextTools("momo-advisor", advisorTools)
    expect(Object.keys(advisorTools)).toEqual(["momo_lsp_status", "momo_ast_grep_search"])
    const workerTools: Record<string, unknown> = { momo_lsp_status: {}, momo_lsp_rename: {}, momo_ast_grep_rewrite: {} }
    filterNativeContextTools("momo-worker", workerTools)
    expect(Object.keys(workerTools)).toEqual(["momo_lsp_status", "momo_lsp_rename", "momo_ast_grep_rewrite"])
  })

  test("does not trust unknown MCP status or search actions as read-only", () => {
    const advisorTools: Record<string, unknown> = {
      mcp__external__status: {}, mcp__external__search: {}, mcp__momo_lsp__status: {},
      read: {}, grep: {}, webfetch: {},
    }
    filterNativeContextTools("momo-advisor", advisorTools)
    expect(Object.keys(advisorTools).sort()).toEqual(["grep", "mcp__momo_lsp__status", "read", "webfetch"])
    expect(nativeActionEffect("momo-advisor", "mcp__external__status")).toBe("deny")
    expect(nativeActionEffect("momo-advisor", "mcp__external__search")).toBe("deny")
    expect(nativeActionEffect("momo-orchestrator", "mcp__external__status")).toBe("deny")
    expect(nativeActionEffect("momo-advisor", "mcp__momo_lsp__status")).toBeUndefined()
    expect(isNativeReadTool("mcp__external__search")).toBe(false)
    expect(isNativeReadTool("webfetch")).toBe(true)
  })
})
