import { describe, expect, it } from "bun:test"
import { createAppClientBridge } from "./app-client-bridge"
import type { V2PluginContext } from "./types"

function createFakeCtx() {
  const calls: Array<{ method: string; args: unknown }> = []
  const ctx = {
    agent: {
      list: async (args: unknown) => {
        calls.push({ method: "agent.list", args })
        return {
          location: { directory: "/repo" },
          data: [
            {
              id: "build",
              name: "build",
              mode: "primary",
              hidden: false,
              description: "main agent",
              model: { id: "glm-5.3", providerID: "opencode-go" },
              request: { settings: {}, headers: {}, body: {} },
              permissions: [],
            },
            {
              id: "explore",
              name: "explore",
              mode: "subagent",
              hidden: false,
              request: { settings: {}, headers: {}, body: {} },
              permissions: [],
            },
          ],
        }
      },
    },
  } as unknown as V2PluginContext
  return { ctx, calls }
}

describe("createAppClientBridge", () => {
  it("delegates agents onto ctx.agent.list and unwraps the data array", async () => {
    // given — call shape copied from tools/delegate-task/subagent-agent-match.ts
    const { ctx, calls } = createFakeCtx()
    const app = createAppClientBridge(ctx)

    // when
    const result = await app.agents()

    // then
    expect(calls).toEqual([{ method: "agent.list", args: undefined }])
    expect(result.error).toBeUndefined()
    expect(result.data).toEqual([
      {
        name: "build",
        description: "main agent",
        mode: "primary",
        hidden: false,
        model: { providerID: "opencode-go", modelID: "glm-5.3" },
      },
      { name: "explore", mode: "subagent", hidden: false },
    ])
  })

  it("routes the V1 query directory into the V2 location input", async () => {
    // given
    const { ctx, calls } = createFakeCtx()
    const app = createAppClientBridge(ctx)

    // when
    await app.agents({ query: { directory: "/repo" } })

    // then
    expect(calls).toEqual([{ method: "agent.list", args: { location: { directory: "/repo" } } }])
  })
})
