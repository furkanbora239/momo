import { describe, expect, test } from "bun:test"
import { createManagedSgResolver } from "./managed-runtime"
import type { SgResolution } from "@oh-my-opencode/utils"

const missing: SgResolution = { found: false, error: { code: "BINARY_NOT_FOUND", message: "missing", hints: [] } }
const found: SgResolution = { found: true, path: "/managed/sg", tier: "omo-runtime" }

describe("managed ast-grep first use", () => {
  test("uses an existing validated binary without a download", async () => {
    const resolve = createManagedSgResolver({ resolve: () => found, provision: async () => { throw new Error("unexpected download") } })
    expect(await resolve()).toBe(found.path)
  })
  test("prepares a missing binary once across overlapping calls and revalidates it", async () => {
    let ready = false, downloads = 0
    const resolve = createManagedSgResolver({ resolve: () => ready ? found : missing, provision: async () => { downloads++; await Bun.sleep(5); ready = true; return found.path } })
    expect(await Promise.all([resolve(), resolve()])).toEqual([found.path, found.path])
    expect(await resolve()).toBe(found.path)
    expect(downloads).toBe(1)
  })
  test("does not retain failed provisioning and allows a later attempt", async () => {
    let ready = false, downloads = 0
    const resolve = createManagedSgResolver({ resolve: () => ready ? found : missing, provision: async () => { if (++downloads === 1) throw new Error("offline"); ready = true; return found.path } })
    await expect(resolve()).rejects.toThrow("offline")
    expect(await resolve()).toBe(found.path)
  })
  test("rejects an unvalidated downloaded executable", async () => {
    const resolve = createManagedSgResolver({ resolve: () => missing, provision: async () => found.path })
    await expect(resolve()).rejects.toThrow("missing")
  })
})
