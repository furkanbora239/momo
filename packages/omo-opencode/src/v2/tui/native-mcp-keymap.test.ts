import { expect, test } from "bun:test"
import type { KeymapCommand } from "@opencode/plugin/tui/context"
import type { V2TuiContext } from "./types"
import { registerNativeMcpKeymap } from "./native-mcp-keymap"

test("project MCP panel persists the selected mode through the server's scoped RPC", async () => {
  const calls: unknown[] = [], commands: KeymapCommand[] = []
  const choices = ["appwrite", "off", undefined]
  const ctx = {
    location: { directory: "/workspace/one" },
    client: { rpc: { call: async (input: unknown) => {
      calls.push(input)
      return { output: { servers: [{ server: "appwrite", mode: "on-demand", status: { status: "disabled" }, draining: false }] } }
    } } },
    ui: { dialog: { select: async () => choices.shift() }, toast: { show: () => { throw new Error("unexpected error toast") } } },
    keymap: { layer: (read: () => { commands: KeymapCommand[] }) => { commands.push(...read().commands) } },
  } as unknown as V2TuiContext
  registerNativeMcpKeymap(ctx)
  expect(commands[0]?.slash?.name).toBe("mcp-policy")
  await commands[0]!.run()
  expect(calls).toContainEqual({ rpcID: "momo.mcp", method: "setMode", input: { server: "appwrite", mode: "off" }, location: { directory: "/workspace/one" } })
  expect(calls).toHaveLength(3)
})
