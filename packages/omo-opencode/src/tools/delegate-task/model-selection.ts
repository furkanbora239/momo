import {
  resolveModelForDelegateTask as resolveModelForDelegateTaskCore,
  type DelegateFallbackEntry,
  type DelegateModelResolutionInput,
  type DelegateModelResolutionResult,
} from "@oh-my-opencode/delegate-core"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"
import { log } from "../../shared/logger"

export type { DelegateFallbackEntry, DelegateModelResolutionInput, DelegateModelResolutionResult }

export function resolveModelForDelegateTask(input: DelegateModelResolutionInput): DelegateModelResolutionResult {
  const connectedProviders = input.availableModels.size === 0
    ? connectedProvidersCache.readConnectedProvidersCache()
    : null

  return resolveModelForDelegateTaskCore(input, {
    connectedProviders,
    hasProviderModelsCache: connectedProvidersCache.hasProviderModelsCache(),
    hasConnectedProvidersCache: connectedProvidersCache.hasConnectedProvidersCache(),
    log,
  })
}

export function hasReachableFallbackChainRung(
  requirement: { readonly fallbackChain?: readonly DelegateFallbackEntry[] } | undefined,
  availableModels: ReadonlySet<string>,
): boolean {
  if (!requirement?.fallbackChain || availableModels.size === 0) return false
  const probe = resolveModelForDelegateTaskCore(
    { fallbackChain: requirement.fallbackChain, availableModels },
    { connectedProviders: null, hasProviderModelsCache: false, hasConnectedProvidersCache: false },
  )
  return probe !== undefined && !("skipped" in probe)
}
