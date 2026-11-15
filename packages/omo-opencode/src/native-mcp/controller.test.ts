import { describe, expect, test } from "bun:test"
import { createNativeMcpController } from "./controller"
import type { McpMode, McpPolicy } from "./policy"

function fixture() {
  let modes: McpPolicy = {}, disabled: string[] = []
  const controller = createNativeMcpController({
    settings: () => ({ modes, disabledMcps: disabled }),
    persist: async (server: string, mode: McpMode) => { modes = { ...modes, [server]: mode } },
    reload: async () => undefined,
  })
  controller.observe([{ name: "appwrite", upstreamDisabled: false }, { name: "momo_lsp", upstreamDisabled: false }, { name: "codegraph", upstreamDisabled: false }])
  return { controller, disable: () => { disabled = ["appwrite"] } }
}
describe("project MCP lifecycle", () => {
  test("starts only requested external servers and deduplicates session leases", async () => {
    const { controller } = fixture()
    expect(controller.shouldConnect("appwrite")).toBe(false)
    expect(controller.shouldConnect("momo_lsp")).toBe(true)
    expect(controller.shouldConnect("codegraph")).toBe(false)
    await controller.activate("appwrite", "one")
    await controller.activate("appwrite", "one")
    expect(controller.shouldConnect("appwrite")).toBe(true)
    await controller.release("appwrite", "one")
    expect(controller.shouldConnect("appwrite")).toBe(false)
  })
  test("keeps other leases and drains existing calls when user disables a server", async () => {
    const { controller } = fixture()
    await controller.activate("appwrite", "one")
    await controller.activate("appwrite", "two")
    await controller.release("appwrite", "one")
    expect(controller.shouldConnect("appwrite")).toBe(true)
    controller.beginCall("appwrite", "call")
    await controller.setMode("appwrite", "off")
    expect(controller.canCall("appwrite")).toBe(false)
    expect(controller.shouldConnect("appwrite")).toBe(true)
    await controller.endCall("call")
    expect(controller.shouldConnect("appwrite")).toBe(false)
    await expect(controller.activate("appwrite", "two")).rejects.toThrow()
  })
  test("cannot activate hard-disabled or unknown servers", async () => {
    const { controller, disable } = fixture()
    disable()
    await expect(controller.activate("appwrite", "one")).rejects.toThrow()
    await expect(controller.activate("unknown", "one")).rejects.toThrow()
  })
  test("a failed reload retains persisted policy but does not invent a connection", async () => {
    let mode: McpMode = "on-demand"
    const controller = createNativeMcpController({ settings: () => ({ modes: { appwrite: mode } }), persist: async (_server, value) => { mode = value }, reload: async () => { throw new Error("unavailable") } })
    controller.observe([{ name: "appwrite" }])
    await expect(controller.setMode("appwrite", "off")).rejects.toThrow("unavailable")
    expect(controller.shouldConnect("appwrite")).toBe(false)
    await expect(controller.activate("appwrite", "one")).rejects.toThrow()
  })
})
