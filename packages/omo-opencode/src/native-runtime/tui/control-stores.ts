import { resolveNativeHomeDirectory, resolveNativeOmoDirectory } from "../../native-catalog/paths"
import { createNativeControlStores } from "../../native-catalog/native-control-stores"

export function resolveNativeControlDirectory(homeDirectory?: string): string {
  return resolveNativeOmoDirectory(resolveNativeHomeDirectory(homeDirectory))
}

export function createNativeCatalogControlStores(homeDirectory?: string) {
  return createNativeControlStores(homeDirectory)
}
