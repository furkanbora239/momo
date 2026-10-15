import { describe, expect, test } from "bun:test"
import { nativePermissionEffect } from "./permission-policy"
import { filterNativeContextTools, nativeActionEffect } from "./role-policy"

const readonlyRoles = ["momo-orchestrator", "momo-planner", "momo-executor", "momo-reviewer", "momo-advisor", "momo-catalog-researcher"] as const

describe("native secondary directory permission", () => {
  for (const role of readonlyRoles) {
    test(`${role} preserves native resource policy without granting outside access`, () => {
      // given OpenCode has already evaluated a secondary directory resource
      for (const nativeEffect of ["ask", "allow", "deny"] as const) {
        // when the momo permission hook has no override for this resource gate
        const override = nativePermissionEffect(role, "external_directory")
        // then configured policy and native user authorization remain authoritative
        expect(override).toBeUndefined()
        expect(override ?? nativeEffect).toBe(nativeEffect)
      }
      expect(nativePermissionEffect(role, "read")).toBeUndefined()
      expect(nativePermissionEffect(role, "grep")).toBeUndefined()
    })
  }
  for (const role of readonlyRoles.slice(0, 4)) {
    test(`${role} still rejects mutation and unknown actions at both boundaries`, () => {
      const prohibited = ["shell", "bash", "edit", "write", "apply_patch", "external_operate", "mcp__external__operate", "external_directory"]
      const tools: Record<string, unknown> = Object.fromEntries([...prohibited, "read", "grep"].map((name) => [name, {}]))
      filterNativeContextTools(role, tools)
      expect(Object.keys(tools)).toEqual(["read", "grep"])
      for (const action of prohibited) expect(nativeActionEffect(role, action)).toBe("deny")
      for (const action of prohibited.filter((name) => name !== "external_directory")) {
        expect(nativePermissionEffect(role, action)).toBe("deny")
      }
    })
  }
})
