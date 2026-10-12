import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { access, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createNativeSearchMcpConfig } from "./mcp-config"
import { provisionNativeSearchBinary, resolveNativeSearchBinary } from "./runtime"
import { NATIVE_SEARCH_LICENSE_SHA256, NATIVE_SEARCH_LICENSE_TEXT } from "./license"

describe("native search V2 MCP configuration", () => {
  test("pins the exact upstream v0.11.0 license text used beside the managed binary", () => {
    expect(createHash("sha256").update(NATIVE_SEARCH_LICENSE_TEXT).digest("hex")).toBe(NATIVE_SEARCH_LICENSE_SHA256)
  })

  test("stays disabled unless explicitly enabled with a verified managed binary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "momo-native-search-config-"))
    try {
      const options = {
        runtimeRoot: join(directory, "runtime"),
        cacheRoot: join(directory, "cache"),
        allowedRoot: directory,
      }
      const defaults = await createNativeSearchMcpConfig(options)
      expect(defaults).toMatchObject({ type: "local", disabled: true })
      expect(defaults.command).toEqual(["codebase-memory-mcp", "serve", "--mcp"])
      const explicit = await createNativeSearchMcpConfig({ ...options, enabled: true })
      expect(explicit.disabled).toBe(true)
      expect(explicit.environment).toMatchObject({ CBM_CACHE_DIR: options.cacheRoot, CBM_RUNTIME_DIR: options.runtimeRoot, CBM_ALLOWED_ROOT: directory })
      expect(await resolveNativeSearchBinary({ ...options, platform: "linux", arch: "arm64" })).toBeUndefined()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test("rejects unverified release bytes before extraction or installation", async () => {
    const directory = await mkdtemp(join(tmpdir(), "momo-native-search-provision-"))
    try {
      await expect(provisionNativeSearchBinary({
        platform: "darwin",
        arch: "arm64",
        runtimeRoot: join(directory, "runtime"),
        fetcher: async () => new Response("not the pinned archive", { status: 200 }),
      })).rejects.toThrow("archive SHA-256 mismatch")
      await expect(access(join(directory, "runtime"))).rejects.toThrow()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
