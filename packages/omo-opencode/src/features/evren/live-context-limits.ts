import { isRecord } from "@oh-my-opencode/utils"
import { LIVE_MODEL_LIMIT_SOURCE } from "../../shared/provider-model-live-refresh"
import type { ProviderModelsCache } from "../../shared/connected-providers-cache"
import { EVREN_PROVIDER_ID } from "./provider"

/**
 * Context limits the EVREN gateway actually reported via the live /models
 * refresh (cache entries marked with the gateway-live source). Entries whose
 * limit merely echoes the config fallback carry no marker and are ignored.
 */
export function readEvrenLiveContextLimits(
  cache: ProviderModelsCache | null | undefined,
): Record<string, number> {
  const limits: Record<string, number> = {}
  const entries = cache?.models?.[EVREN_PROVIDER_ID]
  if (!Array.isArray(entries)) return limits
  for (const entry of entries) {
    if (!isRecord(entry) || entry.limitSource !== LIVE_MODEL_LIMIT_SOURCE) continue
    if (typeof entry.id !== "string" || entry.id.length === 0) continue
    const context = isRecord(entry.limit) ? entry.limit.context : undefined
    if (typeof context === "number" && Number.isFinite(context) && context > 0) {
      limits[entry.id] = Math.floor(context)
    }
  }
  return limits
}
