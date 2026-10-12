import { homedir } from "node:os"
import { join } from "node:path"

export function resolveNativeHomeDirectory(explicit?: string): string {
  return explicit ?? process.env.OPENCODE_TEST_HOME ?? homedir()
}

export function resolveNativeOmoDirectory(explicit?: string): string {
  return join(resolveNativeHomeDirectory(explicit), ".omo")
}

export function resolveNativeCatalogHealthDirectory(explicit?: string): string {
  return join(resolveNativeOmoDirectory(explicit), "native-cache")
}
