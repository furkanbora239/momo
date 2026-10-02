// config-seed.ts — build the V1-shaped `Config` seed that momo's V1 config
// handler mutates. Every field is derived best-effort from the V2 domains via
// their list APIs; V1 fields with no V2 source stay undefined (the V2 command
// list carries no template, the mcp list carries no server config, agents
// carry no disable flag).
//
// The seed is intentionally partial: because the SDK `Config` type requires
// `template` on command entries and `type` on mcp entries, the loose seed
// record is cast to `Config` once at this boundary. The diff in
// config-bridge.ts treats handler-populated keys as additions, so a partial
// seed can only ADD work, never drop handler mutations.

import type { Config } from "@opencode-ai/plugin"
import type { V2PluginContext } from "./types"
import { convertV2AgentInfoToV1Entry } from "./agent-config-converter"
import { convertV2McpServerToV1Seed } from "./mcp-config-converter"
import {
  convertV2ModelInfoToV1Seed,
  convertV2ProviderInfoToV1Seed,
  type V2ModelListRecord,
  type V2ProviderListRecord,
} from "./provider-config-converter"
import { log } from "../shared/logger"

type V1AgentMap = NonNullable<Config["agent"]>
type V1ProviderMap = NonNullable<Config["provider"]>
type V1ModelConfigMap = NonNullable<NonNullable<V1ProviderMap[string]["models"]>>

/** Client-side list record for one agent (plain strings). */
type V2AgentListRecord = Awaited<ReturnType<V2PluginContext["agent"]["list"]>>["data"][number]
/** Client-side list record for one command. */
type V2CommandListRecord = Awaited<ReturnType<V2PluginContext["command"]["list"]>>["data"][number]
/** Client-side list record for one mcp server. */
type V2McpListRecord = Awaited<ReturnType<V2PluginContext["mcp"]["list"]>>["data"][number]

async function safeList<T>(label: string, list: () => Promise<T>): Promise<T | undefined> {
  try {
    return await list()
  } catch (error) {
    log(`[v2-config-bridge] ${label} list failed; seeding without it`, {
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

/** Build the seed Config from the V2 domains. Never throws. */
export async function buildV1ConfigSeed(ctx: V2PluginContext): Promise<Config> {
  const agents = await safeList("agent", () => ctx.agent.list())
  const commands = await safeList("command", () => ctx.command.list())
  const mcps = await safeList("mcp", () => ctx.mcp.list())
  const providers = await safeList("provider", () => ctx.provider.list())
  const models = await safeList("model", () => ctx.model.list())
  const defaultModel = await safeList("model default", () => ctx.model.default())

  const agentMap: V1AgentMap = {}
  for (const info of agents?.data ?? []) {
    agentMap[info.id] = convertV2AgentInfoToV1Entry(info as V2AgentListRecord)
  }

  const commandMap: Record<string, unknown> = {}
  for (const info of commands?.data ?? []) {
    commandMap[info.name] = { description: info.description }
  }

  const mcpMap: Record<string, unknown> = {}
  for (const server of mcps?.data ?? []) {
    mcpMap[server.name] = convertV2McpServerToV1Seed(server as V2McpListRecord)
  }

  const modelsByProvider = new Map<string, V1ModelConfigMap>()
  for (const info of models?.data ?? []) {
    const entry = modelsByProvider.get(info.providerID) ?? {}
    entry[info.modelID] = convertV2ModelInfoToV1Seed(info as V2ModelListRecord)
    modelsByProvider.set(info.providerID, entry)
  }

  const providerMap: V1ProviderMap = {}
  for (const info of providers?.data ?? []) {
    providerMap[info.id] = {
      ...convertV2ProviderInfoToV1Seed(info as V2ProviderListRecord),
      models: modelsByProvider.get(info.id) ?? {},
    }
  }

  const primaryAgent = (agents?.data ?? []).find((info) => info.mode === "primary")
  const seed: Record<string, unknown> = {
    ...(Object.keys(agentMap).length > 0 ? { agent: agentMap } : {}),
    ...(Object.keys(commandMap).length > 0 ? { command: commandMap } : {}),
    ...(Object.keys(mcpMap).length > 0 ? { mcp: mcpMap } : {}),
    ...(Object.keys(providerMap).length > 0 ? { provider: providerMap } : {}),
    ...(primaryAgent !== undefined ? { default_agent: primaryAgent.id } : {}),
    ...(defaultModel?.data !== undefined && defaultModel.data !== null
      ? { model: `${defaultModel.data.providerID}/${defaultModel.data.modelID}` }
      : {}),
  }
  return seed as Config
}
