import type { NativeCatalogAdapter } from "../native-catalog"
import type { NativeAdvisorPoolControl } from "./tui/catalog-controls"

const catalogs = new Map<string, NativeCatalogAdapter>()
const advisorPools = new Map<string, NativeAdvisorPoolControl>()

export function registerNativeCatalog(directory: string, catalog: NativeCatalogAdapter): () => void {
  catalogs.set(directory, catalog)
  return () => {
    if (catalogs.get(directory) === catalog) catalogs.delete(directory)
  }
}

export function getNativeCatalog(directory: string): NativeCatalogAdapter | undefined {
  return catalogs.get(directory)
}

export function registerNativeAdvisorPool(directory: string, control: NativeAdvisorPoolControl): () => void {
  advisorPools.set(directory, control)
  return () => {
    if (advisorPools.get(directory) === control) advisorPools.delete(directory)
  }
}

export function getNativeAdvisorPool(directory: string): NativeAdvisorPoolControl | undefined {
  return advisorPools.get(directory)
}

