import type { ProviderInfo } from "@opencode/client"
import { isProviderDisabled } from "../shared/provider-toggles"
import type { ProviderHealthSnapshot } from "../shared/provider-health"
import type { ProviderToggles } from "../shared/provider-toggles"
import { isOfficialPublicProvider } from "./public-provider"
import type { NativeModelRef } from "../native-routing/types"
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
  publicModels?: readonly NativeModelRef[]
}): Promise<{ providers: ProviderInfo[]; publicOnlyProviders: string[]; unavailable: Record<string, { reason: string; until?: number; statusCode?: number }> }> {
  const registered = (await input.context.provider.list()).data
  const connectionStates = await Promise.all(registered.map(async (provider) => ({
    provider,
    connected: !provider.integrationID || await input.context.integration.connection.active(provider.integrationID) !== undefined,
  })))
  // The native API returns snapshots. A provider may be disabled, removed or
  // rebound while its earlier integration lookup is waiting.
  const currentModels = input.publicModels?.length && input.context.model ? (await input.context.model.list()).data : []
  const latest = (await input.context.provider.list()).data
  const observed = new Map(connectionStates.map(state => [state.provider.id, state]))
  // Read local controls after all asynchronous native lookups.
  const toggles = input.toggles(), health = input.health(), now = input.now()
  const unavailable: Record<string, { reason: string; until?: number; statusCode?: number }> = {}
  const publicOnlyProviders: string[] = []
  const providers = latest.flatMap((provider) => {
    const previous = observed.get(provider.id)
    const bindingChanged = !previous || previous.provider.integrationID !== provider.integrationID
    const publicAccess = isOfficialPublicProvider(provider) && input.publicModels?.some(model => model.providerID === provider.id
      && isOfficialPublicProvider(provider, currentModels.find(current => current.providerID === model.providerID && current.id === model.id)))
    const reason = nativeProviderBlockReason(provider, toggles, health, now) ??
      (bindingChanged ? "provider integration changed during admission" : !previous.connected && !publicAccess ? "no active OpenCode integration connection" : undefined)
    if (reason !== undefined) {
      const blocked = health[provider.id.trim().toLowerCase()]
      const healthBlocked = provider.activation !== "disabled" && !isProviderDisabled(toggles, provider.id) && blocked && now < blocked.unavailableUntil
      unavailable[provider.id] = { reason, ...(healthBlocked ? { until: blocked.unavailableUntil, ...(blocked.statusCode === undefined ? {} : { statusCode: blocked.statusCode }) } : {}) }
      return []
    }
    if (!previous?.connected && publicAccess) publicOnlyProviders.push(provider.id)
    return [provider]
  })
  return { providers, publicOnlyProviders, unavailable }
}
