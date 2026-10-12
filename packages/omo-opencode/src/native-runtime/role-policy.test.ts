import { describe, expect, test } from "bun:test"
import { filterNativeContextTools, nativeActionEffect, nativeAgentPermissions, nativeToolAllowed, ownedAgentID } from "./role-policy"

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
