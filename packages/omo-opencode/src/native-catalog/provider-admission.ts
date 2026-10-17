import type { ProviderInfo } from "@opencode/client"
import { isProviderDisabled } from "../shared/provider-toggles"
import type { ProviderHealthSnapshot } from "../shared/provider-health"
import type { ProviderToggles } from "../shared/provider-toggles"
import type { NativeCatalogContext } from "./types"

export function nativeProviderBlockReason(
  provider: ProviderInfo,
  toggles: ProviderToggles,
  health: ProviderHealthSnapshot,
  now: number,
): string | undefined {
  if (provider.activation === "disabled") return "disabled in OpenCode provider settings"
  if (isProviderDisabled(toggles, provider.id)) return "disabled by provider toggle"
  const blocked = health[provider.id.trim().toLowerCase()]
  if (blocked && now < blocked.unavailableUntil) return blocked.reason
  return undefined
}

export async function connectedNativeProviders(input: {
  context: NativeCatalogContext
  toggles: () => ProviderToggles
  health: () => ProviderHealthSnapshot
  now: () => number
}): Promise<{ providers: ProviderInfo[]; unavailable: Record<string, { reason: string; until?: number; statusCode?: number }> }> {
  const registered = (await input.context.provider.list()).data
  const connectionStates = await Promise.all(registered.map(async (provider) => ({
    provider,
    connected: !provider.integrationID || await input.context.integration.connection.active(provider.integrationID) !== undefined,
  })))
  // Read local controls after the asynchronous native connection lookups.
  const toggles = input.toggles(), health = input.health(), now = input.now()
  const unavailable: Record<string, { reason: string; until?: number; statusCode?: number }> = {}
  const providers = connectionStates.flatMap(({ provider, connected }) => {
    const reason = nativeProviderBlockReason(provider, toggles, health, now) ?? (!connected ? "no active OpenCode integration connection" : undefined)
    if (reason !== undefined) {
      const blocked = health[provider.id.trim().toLowerCase()]
      const healthBlocked = provider.activation !== "disabled" && !isProviderDisabled(toggles, provider.id) && blocked && now < blocked.unavailableUntil
      unavailable[provider.id] = { reason, ...(healthBlocked ? { until: blocked.unavailableUntil, ...(blocked.statusCode === undefined ? {} : { statusCode: blocked.statusCode }) } : {}) }
      return []
    }
    return [provider]
  })
  return { providers, unavailable }
}
