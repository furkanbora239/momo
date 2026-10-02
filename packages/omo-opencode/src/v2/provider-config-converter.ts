// provider-config-converter.ts — pure converters between momo's V1 provider
// config entries (see src/shared/provider-model-config-injection.ts and
// features/evren/provider.ts for the shapes momo produces) and the V2
// provider/model domain records.
//
// Typing split (grounded from the .d.ts files): list APIs return CLIENT
// records with plain strings, while editor callbacks expose SCHEMA records
// with branded ids/numerics. Reads use the client shapes via the plugin
// context; writes synthesize the registry-complete schema shapes and apply
// one documented `as unknown as` cast per record, because plain config data
// carries no brands.
//
// The V2 model editor cannot create models (its update only mutates existing
// records), so live-only model entries ride into V2 through the provider
// transform's non-destructive `models.set` append.

import type { Model, Provider } from "@opencode/plugin"
import type { V2PluginContext } from "./types"
import type { ProviderConfig } from "@opencode-ai/sdk"

export type V1ProviderConfig = ProviderConfig
export type V1ModelConfig = NonNullable<ProviderConfig["models"]>[string]

/** Client-side list record for one provider (plain strings). */
export type V2ProviderListRecord = Awaited<ReturnType<V2PluginContext["provider"]["list"]>>["data"][number]
/** Client-side list record for one model (plain strings). */
export type V2ModelListRecord = Awaited<ReturnType<V2PluginContext["model"]["list"]>>["data"][number]

const MODALITY_LITERALS = ["text", "audio", "image", "video", "pdf"] as const
type V1Modality = (typeof MODALITY_LITERALS)[number]

interface V1ModelConfigView {
  readonly name?: unknown
  readonly release_date?: unknown
  readonly tool_call?: unknown
  readonly status?: unknown
  readonly limit?: { readonly context?: unknown; readonly output?: unknown }
  readonly modalities?: { readonly input?: unknown; readonly output?: unknown }
  readonly cost?: { readonly input?: unknown; readonly output?: unknown; readonly cache_read?: unknown; readonly cache_write?: unknown }
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function readModalityList(value: unknown): V1Modality[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is V1Modality =>
    (MODALITY_LITERALS as readonly unknown[]).includes(item),
  )
}

function parseReleaseDate(value: unknown): number {
  if (typeof value !== "string") return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function convertV1ModelCost(cost: V1ModelConfigView["cost"]): {
  input: number
  output: number
  cache: { read: number; write: number }
}[] {
  if (cost === undefined) return []
  const input = readNumber(cost.input)
  const output = readNumber(cost.output)
  if (input === undefined || output === undefined) return []
  return [
    {
      input,
      output,
      cache: {
        read: readNumber(cost.cache_read) ?? 0,
        write: readNumber(cost.cache_write) ?? 0,
      },
    },
  ]
}

/** V1 model config -> synthesized registry-complete V2 Model.Info. */
export function convertV1ModelConfigToV2(
  providerID: string,
  modelID: string,
  entry: V1ModelConfig,
): Model.Info {
  const view: V1ModelConfigView = entry ?? {}
  const modalitiesInput = readModalityList(view.modalities?.input)
  const modalitiesOutput = readModalityList(view.modalities?.output)
  const synthesized = {
    id: modelID,
    modelID,
    providerID,
    name: typeof view.name === "string" && view.name.length > 0 ? view.name : modelID,
    capabilities: {
      tools: view.tool_call !== false,
      input: modalitiesInput.length > 0 ? modalitiesInput : ["text"],
      output: modalitiesOutput.length > 0 ? modalitiesOutput : ["text"],
    },
    variants: [],
    time: { released: parseReleaseDate(view.release_date) },
    cost: convertV1ModelCost(view.cost),
    status: view.status === "alpha" || view.status === "beta" || view.status === "deprecated"
      ? view.status
      : "active",
    enabled: true,
    limit: {
      context: readNumber(view.limit?.context) ?? 0,
      output: readNumber(view.limit?.output) ?? 0,
    },
  }
  return synthesized as unknown as Model.Info
}

/** V1 provider config -> synthesized registry-complete V2 Provider.Info. */
export function convertV1ProviderConfigToV2(providerID: string, config: V1ProviderConfig): Provider.Info {
  const options = typeof config.options === "object" && config.options !== null ? config.options : undefined
  const synthesized = {
    id: providerID,
    name: config.name ?? providerID,
    // V1 has no activation notion; injected providers start enabled.
    activation: "enabled",
    package: config.npm ?? "",
    ...(options !== undefined ? { settings: structuredClone(options) } : {}),
  }
  return synthesized as unknown as Provider.Info
}

/**
 * Append V1 model entries that the V2 model list does not carry yet
 * (live-only injected ids). Existing records are preserved untouched because
 * the V2 model editor cannot recreate registry-sourced fields. Pure and
 * synchronous.
 */
export function appendV1ProviderModels(
  providerID: string,
  existing: readonly Model.Info[],
  models: Record<string, V1ModelConfig>,
): Model.Info[] {
  const merged: Model.Info[] = existing.map((info) => structuredClone(info))
  const present = new Set<string>(merged.map((info) => info.modelID))
  for (const [modelID, entry] of Object.entries(models)) {
    if (present.has(modelID)) continue
    merged.push(convertV1ModelConfigToV2(providerID, modelID, entry))
  }
  return merged
}

/** V2 provider info -> V1-shaped seed entry (best-effort). */
export function convertV2ProviderInfoToV1Seed(info: V2ProviderListRecord): V1ProviderConfig {
  return {
    ...(info.name !== undefined ? { name: info.name } : {}),
    ...(typeof info.package === "string" && info.package.length > 0 ? { npm: info.package } : {}),
    ...(info.settings !== undefined ? { options: structuredClone(info.settings) } : {}),
  }
}

/** V2 model info -> V1-shaped seed entry (best-effort). */
export function convertV2ModelInfoToV1Seed(info: V2ModelListRecord): V1ModelConfig {
  const cost = info.cost[0]
  const input = readModalityList(info.capabilities?.input)
  const output = readModalityList(info.capabilities?.output)
  return {
    ...(info.name !== undefined ? { name: info.name } : {}),
    ...(info.limit !== undefined
      ? { limit: { context: info.limit.context, output: info.limit.output } }
      : {}),
    ...(info.capabilities !== undefined ? { tool_call: info.capabilities.tools } : {}),
    ...(input.length > 0 || output.length > 0
      ? { modalities: { input: input.length > 0 ? input : (["text"] as V1Modality[]), output: output.length > 0 ? output : (["text"] as V1Modality[]) } }
      : {}),
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
    ...(info.status !== undefined ? { status: info.status } : {}),
  }
}
