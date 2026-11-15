// MODIFIED: use the active OpenCode profile for private connector definitions.
import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { getOpenCodeConfigDir } from "../shared/opencode-config-dir"
import { homeRoot } from "../native-runtime/user-data-paths"
import { adoptNativeMcpServers, nativeMcpRegistryPath } from "./registry"

export function nativeMcpConfiguration(home = homeRoot()) {
  const directory = getOpenCodeConfigDir({ binary: "opencode" })
  const jsonc = join(directory, "opencode.jsonc")
  const configPath = existsSync(jsonc) ? jsonc : join(directory, "opencode.json")
  return { configPath, registryPath: nativeMcpRegistryPath(home, dirname(configPath)) }
}
export async function adoptConfiguredNativeMcps(configPath?: string) {
  const paths = nativeMcpConfiguration()
  const source = configPath ?? paths.configPath
  if (!existsSync(source)) return { servers: [], backupPath: "" }
  return adoptNativeMcpServers({ configPath: source, registryPath: nativeMcpRegistryPath(homeRoot(), dirname(source)) })
}
