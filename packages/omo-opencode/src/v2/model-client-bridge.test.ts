import { describe, expect, it } from "bun:test"
import { createModelClientBridge } from "./model-client-bridge"
import type { V2PluginContext } from "./types"

function createFakeCtx() {
  const calls: Array<{ method: string; args: unknown }> = []
  const modelInfo = {
    id: "glm-5.3",
    modelID: "glm-5.3",
    providerID: "opencode-go",
    name: "GLM 5.3",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [],
    status: "active",
    enabled: true,
    limit: { context: 200000, output: 32000 },
  }
  const ctx = {
    model: {
      list: async (args: unknown) => {
        calls.push({ method: "model.list", args })
        return { location: { directory: "/repo" }, data: [modelInfo] }
      },
    },
  } as unknown as V2PluginContext
  return { ctx, calls }
}

describe("createModelClientBridge", () => {
  it("delegates list onto ctx.model.list and aliases provider/id keys", async () => {
    // given — call shape copied from shared/model-availability.ts
    const { ctx, calls } = createFakeCtx()
    const model = createModelClientBridge(ctx)

    // when
    const result = await model.list()

    // then
    expect(calls).toEqual([{ method: "model.list", args: undefined }])
    expect(result.error).toBeUndefined()
    expect(result.data).toEqual([
      {
        id: "glm-5.3",
        modelID: "glm-5.3",
        providerID: "opencode-go",
        provider: "opencode-go",
        name: "GLM 5.3",
        capabilities: { tools: true, input: ["text"], output: ["text"] },
        variants: [],
        time: { released: 0 },
        cost: [],
        status: "active",
        enabled: true,
        limit: { context: 200000, output: 32000 },
      },
    ])
  })

  it("routes the V1 query directory into the V2 location input", async () => {
    // given
    const { ctx, calls } = createFakeCtx()
    const model = createModelClientBridge(ctx)

    // when
    await model.list({ query: { directory: "/repo" } })

    // then
    expect(calls).toEqual([{ method: "model.list", args: { location: { directory: "/repo" } } }])
  })
})
