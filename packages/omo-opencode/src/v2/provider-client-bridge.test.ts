import { describe, expect, it } from "bun:test"
import { createProviderClientBridge } from "./provider-client-bridge"
import type { V2PluginContext } from "./types"

type RecordedCall = { method: string; args: unknown }

function createFakeCtx() {
  const calls: RecordedCall[] = []
  const ctx = {
    provider: {
      list: async (args: unknown) => {
        calls.push({ method: "provider.list", args })
        return {
          location: { directory: "/repo" },
          data: [
            { id: "opencode-go", name: "opencode-go", activation: "auto", package: "pkg" },
            { id: "openai", name: "openai", activation: "auto", package: "pkg" },
          ],
        }
      },
    },
    model: {
      list: async (args: unknown) => {
        calls.push({ method: "model.list", args })
        return {
          location: { directory: "/repo" },
          data: [
            {
              id: "glm-5.3",
              modelID: "glm-5.3",
              providerID: "opencode-go",
              name: "GLM 5.3",
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              variants: [],
              time: { released: 0 },
              cost: [{ input: 1, output: 2, cache: { read: 0.1, write: 0.2 } }],
              status: "active",
              enabled: true,
              limit: { context: 200000, output: 32000 },
            },
          ],
        }
      },
    },
  } as unknown as V2PluginContext
  return { ctx, calls }
}

describe("createProviderClientBridge", () => {
  it("joins provider.list and model.list into the V1 provider list payload", async () => {
    // given — call shape copied from shared/connected-providers-cache.ts
    const { ctx, calls } = createFakeCtx()
    const provider = createProviderClientBridge(ctx)

    // when
    const result = await provider.list()

    // then
    expect(calls).toEqual([
      { method: "provider.list", args: undefined },
      { method: "model.list", args: undefined },
    ])
    expect(result.error).toBeUndefined()
    expect(result.data?.connected).toEqual(["opencode-go"])
    expect(result.data?.all).toHaveLength(2)
    expect(result.data?.all[0]).toEqual({
      id: "opencode-go",
      name: "opencode-go",
      models: {
        "glm-5.3": {
          id: "glm-5.3",
          provider: "opencode-go",
          name: "GLM 5.3",
          limit: { context: 200000, output: 32000 },
          status: "active",
          cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 },
        },
      },
    })
    expect(result.data?.all[1]).toEqual({ id: "openai", name: "openai", models: {} })
  })

  it("routes the V1 query directory into the V2 location input", async () => {
    // given
    const { ctx, calls } = createFakeCtx()
    const provider = createProviderClientBridge(ctx)

    // when
    await provider.list({ query: { directory: "/repo" } })

    // then
    expect(calls).toEqual([
      { method: "provider.list", args: { location: { directory: "/repo" } } },
      { method: "model.list", args: { location: { directory: "/repo" } } },
    ])
  })
})
