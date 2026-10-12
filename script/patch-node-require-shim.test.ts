import { describe, expect, test } from "bun:test"
import { patchNodeRequireShim } from "./patch-node-require-shim"

const bunHelper = "var __require = import.meta.require;"

describe("patchNodeRequireShim", () => {
  test("patches Bun's require helper for Node and Electron", () => {
    const result = patchNodeRequireShim(`${bunHelper}\nconst value = __require(\"node:fs\")`, "dist/index.js")

    expect(result.status).toBe("patched")
    expect(result.content).toContain('typeof import.meta.require === "function" ? import.meta.require : __omoCreateRequire(import.meta.url)')
    expect(result.content).toContain('const value = __require("node:fs")')
  })

  test("leaves a bundle without require calls unchanged when Bun emits no helper", () => {
    const source = 'export const value = "no require needed"'

    expect(patchNodeRequireShim(source, "dist/index.js")).toEqual({ content: source, status: "not-needed" })
  })

  test("fails when the Bun helper is absent but generated require calls remain", () => {
    expect(() => patchNodeRequireShim('const value = __require("node:fs")', "dist/index.js"))
      .toThrow("Expected Bun require helper not found in dist/index.js, but __require calls remain")
  })

  test("is idempotent for an already patched bundle", () => {
    const source = 'import { createRequire as __omoCreateRequire } from "node:module";\nvar __require = typeof import.meta.require === "function" ? import.meta.require : __omoCreateRequire(import.meta.url);'

    expect(patchNodeRequireShim(source, "dist/index.js")).toEqual({ content: source, status: "already-patched" })
  })
})
