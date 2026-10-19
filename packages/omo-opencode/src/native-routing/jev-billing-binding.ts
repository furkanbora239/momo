// MODIFIED: momo binds budget admission to the actual Jev HTTP destination and model.
import { jevInputPricePerMillion, type JevClientDeps } from "@oh-my-opencode/decision-core"
import type { NativeJevBillingBinding } from "./types"

export function nativeJevBillingBinding(deps: Pick<JevClientDeps, "model" | "baseUrl">): NativeJevBillingBinding {
  return { model: deps.model ?? "jev-1.13", endpoint: `${(deps.baseUrl ?? "https://opencode.ai/zen/v1").replace(/\/+$/, "")}/systemone` }
}

export function isNativeJevBillingBinding(value: unknown): value is NativeJevBillingBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const binding = value as Record<string, unknown>
  return typeof binding.model === "string" && binding.model.length > 0 && typeof binding.endpoint === "string" && /^https?:\/\//.test(binding.endpoint)
}

export function isFreeNativeJevBinding(binding: NativeJevBillingBinding | undefined): boolean {
  return binding !== undefined && jevInputPricePerMillion(binding.model, binding.endpoint) === 0
}

export function sameNativeJevBinding(left: NativeJevBillingBinding, right: NativeJevBillingBinding): boolean {
  return left.model === right.model && left.endpoint === right.endpoint
}
