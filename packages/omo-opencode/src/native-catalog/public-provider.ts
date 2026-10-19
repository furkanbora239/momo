import type { ModelInfo, ProviderInfo } from "@opencode/client"

/** Public admission is limited to the native official provider, never a custom endpoint. */
export function isOfficialPublicProvider(provider: ProviderInfo, model?: Pick<ModelInfo, "settings">): boolean {
  if (provider.id !== "opencode") return false
  return [provider.settings?.baseURL ?? provider.settings?.baseUrl, model?.settings?.baseURL ?? model?.settings?.baseUrl].every(endpoint => {
    if (endpoint === undefined) return true
    if (typeof endpoint !== "string") return false
    return ["https://opencode.ai/zen/v1", "https://opencode.ai/inference/openai/v1"].includes(endpoint.replace(/\/+$/, ""))
  })
}
