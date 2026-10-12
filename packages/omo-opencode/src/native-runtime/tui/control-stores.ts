import { join } from "node:path"
import { createModelPoolStore } from "../../shared/model-pool"
import { createProviderTogglesStore } from "../../shared/provider-toggles"
import { resolveNativeHomeDirectory, resolveNativeOmoDirectory } from "../../native-catalog/paths"

export function resolveNativeControlDirectory(homeDirectory?: string): string {
  return resolveNativeOmoDirectory(resolveNativeHomeDirectory(homeDirectory))
}

export function createNativeCatalogControlStores(homeDirectory?: string) {
  const directory = resolveNativeControlDirectory(homeDirectory)
  const pool = createModelPoolStore(() => join(directory, "model-pool.json"))
  const providers = createProviderTogglesStore(() => join(directory, "provider-toggles.json"))
  return {
    readPool: pool.readModelPool,
    writePool: pool.writeModelPool,
    readProviderToggles: providers.readProviderToggles,
    writeProviderToggles: providers.writeProviderToggles,
  }
}
