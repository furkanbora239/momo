// MODIFIED: momo distinguishes the explicit official free Jev binding from estimated paid billing.
export const JEV_INPUT_PRICE_PER_MILLION = 0.042

/** Unknown/custom bindings retain the historical paid estimate; a model name alone does not prove free access. */
export function jevInputPricePerMillion(model: string, endpoint = "https://opencode.ai/zen/v1"): number {
  const normalized = endpoint.replace(/\/+$/, "")
  const official = normalized === "https://opencode.ai/zen/v1" || normalized === "https://opencode.ai/zen/v1/systemone"
  return model === "jev-1.13-free" && official ? 0 : JEV_INPUT_PRICE_PER_MILLION
}
