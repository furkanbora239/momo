import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/service"
import { compareVersions } from "../shared/opencode-version"

export const MINIMUM_NATIVE_RUNTIME_VERSION = "2.0.24"
export type NativeV2Client = ReturnType<typeof OpenCode.make>

export function isSupportedNativeRuntimeVersion(version: string): boolean {
  const major = Number(version.replace(/^v/, "").split(".")[0])
  return major === 2 && compareVersions(version, MINIMUM_NATIVE_RUNTIME_VERSION) >= 0
}

export async function discoverNativeV2Client(): Promise<NativeV2Client> {
  const endpoint = await Service.discover({
    version: isSupportedNativeRuntimeVersion,
  })
  if (endpoint === undefined) {
    throw new Error(`No healthy OpenCode ${MINIMUM_NATIVE_RUNTIME_VERSION}+ native service is registered`)
  }
  const client = OpenCode.make({
    baseUrl: endpoint.url,
    ...(endpoint.auth !== undefined ? { headers: Service.headers(endpoint) } : {}),
  })
  const info = await client.server.info()
  if (!isSupportedNativeRuntimeVersion(info.version)) {
    throw new Error(`OpenCode v2 ${MINIMUM_NATIVE_RUNTIME_VERSION}+ is required; found ${info.version}`)
  }
  return client
}
