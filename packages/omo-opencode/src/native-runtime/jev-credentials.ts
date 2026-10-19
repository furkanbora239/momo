import type { Plugin } from "@opencode/plugin"
import type { ManagerConfig } from "../config/schema/decision-engine"

export async function nativeJevApiKey(ctx: Pick<Plugin.Context, "provider" | "integration">, config: ManagerConfig["jev"]): Promise<string | undefined> {
  if (config.authentication === "none") {
    if (config.model !== "jev-1.13-free" || config.provider_id !== "opencode"
      || config.base_url.replace(/\/+$/, "") !== "https://opencode.ai/zen/v1") throw new Error("Anonymous Jev access requires the official free binding")
    return undefined
  }
  const provider = (await ctx.provider.list()).data.find(item => item.id === config.provider_id)
  if (!provider) throw new Error(`OpenCode provider ${config.provider_id} is not registered`)
  if (!provider.integrationID) {
    const key = provider.settings?.apiKey
    if (typeof key === "string" && key.length > 0) return key
    throw new Error(`OpenCode provider ${config.provider_id} has no native integration connection or configured API key`)
  }
  const connection = await ctx.integration.connection.active(provider.integrationID)
  if (!connection) throw new Error(`OpenCode provider ${config.provider_id} is not connected`)
  const credential = await ctx.integration.connection.resolve(connection)
  if (!credential) throw new Error(`OpenCode provider ${config.provider_id} has no active credential`)
  return credential.type === "key" ? credential.key : credential.access
}
