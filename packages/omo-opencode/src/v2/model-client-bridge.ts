import { toV1Result, type V1ClientResult } from "./client-bridge-result"
import type { V2PluginContext } from "./types"

type V2ModelListOutput = Awaited<ReturnType<V2PluginContext["model"]["list"]>>
type V2ModelInfo = V2ModelListOutput["data"][number]

/**
 * V1 model rows carry `provider` + `id` (model-availability.ts reads exactly
 * those); V2 ModelInfo uses `providerID`/`modelID`. The V2 row is passed
 * through with the V1 key aliases layered on top.
 */
export type V1ModelListData = Array<V2ModelInfo & { id: string; provider: string }>

type V1ModelListArgs = { query?: { directory?: string } } | undefined

export type ModelClientBridge = {
  list: (args?: V1ModelListArgs) => Promise<V1ClientResult<V1ModelListData>>
}

export function createModelClientBridge(ctx: V2PluginContext): ModelClientBridge {
  return {
    list: (args) =>
      toV1Result(async () => {
        const result = await ctx.model.list(
          args?.query?.directory !== undefined
            ? { location: { directory: args.query.directory } }
            : undefined,
        )
        return result.data.map((model) => ({ ...model, id: model.modelID, provider: model.providerID }))
      }),
  }
}
