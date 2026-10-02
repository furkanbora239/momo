import { toV1Result, type V1ClientResult } from "./client-bridge-result"
import type { V2PluginContext } from "./types"

type V2ProviderListOutput = Awaited<ReturnType<V2PluginContext["provider"]["list"]>>
type V2ModelListOutput = Awaited<ReturnType<V2PluginContext["model"]["list"]>>
type V2ModelInfo = V2ModelListOutput["data"][number]

export type V1ProviderModelMetadata = {
  id: string
  provider: string
  name: string
  limit: { context: number; output: number }
  status?: string
  cost?: { input: number; output: number; cache_read: number; cache_write: number }
}

export type V1ProviderEntry = {
  id: string
  name: string
  models: Record<string, V1ProviderModelMetadata>
}

/**
 * The V1 `GET /provider` payload momo consumes (connected-providers-cache.ts,
 * model-availability.ts): `connected` provider IDs plus every provider with its
 * model metadata map.
 */
export type V1ProviderListData = {
  all: V1ProviderEntry[]
  connected: string[]
}

type V1ProviderListArgs = { query?: { directory?: string } } | undefined

export type ProviderClientBridge = {
  list: (args?: V1ProviderListArgs) => Promise<V1ClientResult<V1ProviderListData>>
}

/**
 * Bridges V1 `client.provider.list()` onto the V2 provider + model domains.
 *
 * Return-shape notes: V2 provider rows carry no model map and no connected
 * list, so the bridge joins `ctx.provider.list()` with `ctx.model.list()`.
 * `connected` (V1: providers with configured credentials) is derived as the
 * provider IDs exposing live models — the closest honest V2 signal for the
 * consumers that filter delegation targets by it.
 */
export function createProviderClientBridge(ctx: V2PluginContext): ProviderClientBridge {
  return {
    list: (args) =>
      toV1Result(async () => {
        const location =
          args?.query?.directory !== undefined ? { location: { directory: args.query.directory } } : undefined
        const [providers, models] = await Promise.all([
          ctx.provider.list(location),
          ctx.model.list(location),
        ])
        return assembleProviderListData(providers, models)
      }),
  }
}

function assembleProviderListData(
  providers: V2ProviderListOutput,
  models: V2ModelListOutput,
): V1ProviderListData {
  const modelsByProvider = new Map<string, Record<string, V1ProviderModelMetadata>>()
  for (const model of models.data) {
    const bucket = modelsByProvider.get(model.providerID) ?? {}
    bucket[model.modelID] = adaptModelMetadata(model)
    modelsByProvider.set(model.providerID, bucket)
  }
  const all = providers.data.map((provider) => ({
    id: provider.id,
    name: provider.name,
    models: modelsByProvider.get(provider.id) ?? {},
  }))
  return { all, connected: [...modelsByProvider.keys()] }
}

function adaptModelMetadata(model: V2ModelInfo): V1ProviderModelMetadata {
  const cost = model.cost[0]
  return {
    id: model.modelID,
    provider: model.providerID,
    name: model.name,
    limit: { context: model.limit.context, output: model.limit.output },
    ...(model.status !== undefined ? { status: model.status } : {}),
    ...(cost !== undefined
      ? {
          cost: {
            input: cost.input,
            output: cost.output,
            cache_read: cost.cache.read,
            cache_write: cost.cache.write,
          },
        }
      : {}),
  }
}
