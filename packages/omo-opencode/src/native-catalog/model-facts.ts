import type { ModelInfo } from "@opencode/client"
import type { NativeCatalogAdapterOptions, NativeCatalogModelFacts } from "./types"

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function costFor(model: ModelInfo, provenanceVerified: boolean): { input?: number; output?: number } {
  if (model.cost.length === 0) return {}
  const tiers = [...model.cost].sort((left, right) => (right.tier?.size ?? 0) - (left.tier?.size ?? 0))
  const selected = tiers[0]
  return {
    ...(finiteNumber(selected?.input) === undefined || (selected.input === 0 && !provenanceVerified) ? {} : { input: selected.input }),
    ...(finiteNumber(selected?.output) === undefined || (selected.output === 0 && !provenanceVerified) ? {} : { output: selected.output }),
  }
}

export function nativeModelFacts(
  model: ModelInfo,
  priceSource: NonNullable<NativeCatalogModelFacts["priceSource"]>,
  provenanceVerified: boolean,
  liveContext?: number,
): NativeCatalogModelFacts {
  const cost = costFor(model, provenanceVerified)
  const contextLength = liveContext ?? finiteNumber(model.limit.context)
  const capabilities = [
    ...(model.capabilities.input.includes("image") ? ["vision"] : []),
    ...(model.capabilities.input.includes("audio") ? ["audio"] : []),
    ...(model.capabilities.input.includes("video") ? ["video"] : []),
  ]
  return {
    providerID: model.providerID,
    id: model.id,
    available: model.enabled && model.status !== "deprecated",
    priceSource: cost.input !== undefined || cost.output !== undefined ? priceSource : "unknown",
    ...(cost.input === undefined ? {} : { inputPricePerMillion: cost.input }),
    ...(cost.output === undefined ? {} : { outputPricePerMillion: cost.output }),
    ...(contextLength === undefined ? {} : { contextLength }),
    toolCall: model.capabilities.tools,
    ...(capabilities.length === 0 ? {} : { capabilities }),
  }
}

export function resolveNativePriceSource(
  model: ModelInfo,
  options: NativeCatalogAdapterOptions,
): { readonly source: NonNullable<NativeCatalogModelFacts["priceSource"]>; readonly verified: boolean } {
  const explicit = options.priceProvenance?.(model)
  const hasPublishedPrice = model.cost.some((price) => price.input > 0 || price.output > 0)
  return {
    source: explicit ?? (hasPublishedPrice ? "opencode.model.list" : "unknown"),
    verified: explicit !== undefined,
  }
}
