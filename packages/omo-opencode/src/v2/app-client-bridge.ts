import { toV1Result, type V1ClientResult } from "./client-bridge-result"
import type { V2PluginContext } from "./types"

type V2AgentListOutput = Awaited<ReturnType<V2PluginContext["agent"]["list"]>>
type V2AgentInfo = V2AgentListOutput["data"][number]

/**
 * The V1 `GET /agent` rows momo consumes (subagent-discovery.ts reads name,
 * mode, hidden, model). V2 AgentInfo uses `id` for the model id; the V1 Agent
 * model shape is `{ modelID, providerID }`.
 */
export type V1AgentListData = Array<{
  name: string
  description?: string
  mode: "subagent" | "primary" | "all"
  hidden: boolean
  model?: { providerID: string; modelID: string }
}>

type V1AppAgentsArgs = { query?: { directory?: string } } | undefined

export type AppClientBridge = {
  agents: (args?: V1AppAgentsArgs) => Promise<V1ClientResult<V1AgentListData>>
}

/** Bridges V1 `client.app.agents()` (GET /agent) onto the V2 agent domain. */
export function createAppClientBridge(ctx: V2PluginContext): AppClientBridge {
  return {
    agents: (args) =>
      toV1Result(async () => {
        const result = await ctx.agent.list(
          args?.query?.directory !== undefined
            ? { location: { directory: args.query.directory } }
            : undefined,
        )
        return result.data.map((agent) => ({
          name: agent.name,
          ...(agent.description !== undefined ? { description: agent.description } : {}),
          mode: agent.mode,
          hidden: agent.hidden,
          ...(agent.model !== undefined
            ? { model: { providerID: agent.model.providerID, modelID: agent.model.id } }
            : {}),
        }))
      }),
  }
}
