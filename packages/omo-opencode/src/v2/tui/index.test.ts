import { describe, expect, it } from "bun:test"
import tuiModule, { createV2TuiSetup } from "./index"
import { createFakeV2TuiContext } from "./fake-tui-context"
import type { RoutingStatus } from "../../native-runtime/routing-profile-rpc"

const directory = "/fake/project"
const status: RoutingStatus = {
  active: "auto", revision: "", profiles: {},
  legacy: { decision: { kind: "jev" }, pool: { mode: "all", models: [] }, advisors: [], research: { kind: "inherit" } },
  jev: { label: "opencode/jev-1.13-free", available: true },
  providers: [],
  models: [],
}

describe("native TUI registration", () => {
  it("exports the OpenCode plugin definition and skips project commands without a directory", async () => {
    const fake = createFakeV2TuiContext()
    expect(tuiModule.id).toBe("oh-my-openagent:tui")
    expect(typeof await tuiModule.setup(fake.ctx)).toBe("function")
    expect(fake.keymapLayers).toHaveLength(0)
    expect(fake.slotClaims).toHaveLength(0)
  })

  it("loads the project routing snapshot and keeps the legacy command entry points", async () => {
    const fake = createFakeV2TuiContext({ directory, rpcOutput: status })
    await createV2TuiSetup()(fake.ctx)
    const commands = fake.keymapLayers.flatMap(layer => layer().commands ?? [])
    expect(commands.map(command => command.slash?.name))
      .toEqual(["mcp-policy", "momo-routing", "pool", "momo-routing-providers", "advisor-pool"])
    expect(commands.find(command => command.id === "omo.native.providers")?.slash?.aliases).toEqual(["providers"])
    await commands.find(command => command.id === "omo.native.pool")?.run()
    expect(fake.clientRpcCalls).toEqual([{ rpcID: "momo.routing", method: "snapshot", location: { directory }, input: {} }])
    expect(fake.dialogSelects[0]?.options.map(option => option.value)).toEqual(["all", "allowlist", "paused"])
    expect(fake.keymapLayers.map(layer => layer().mode)).toEqual(["global", "global"])
  })

  it("reports snapshot failure without opening a partial editor", async () => {
    const fake = createFakeV2TuiContext({ directory })
    fake.ctx.client.rpc.call = async () => { throw new Error("server is offline") }
    await createV2TuiSetup()(fake.ctx)
    await fake.keymapLayers.flatMap(layer => layer().commands ?? []).find(command => command.id === "omo.native.routing")?.run()
    expect(fake.toasts).toEqual([{ title: "Momo routing unavailable", message: "server is offline", variant: "error" }])
    expect(fake.dialogSelects).toHaveLength(0)
  })
})
