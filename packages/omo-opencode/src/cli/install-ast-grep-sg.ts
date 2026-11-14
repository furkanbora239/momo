// MODIFIED: install only the checksum-verified managed runtime, never global packages.
import { homedir } from "node:os"
import { join } from "node:path"
import { astGrepRuntimeDir, provisionSgBinary, resolveSgBinarySync, type SgProvisionOptions, type SgResolverOptions, type SgResolution } from "@oh-my-opencode/utils"

export interface OpenCodeAstGrepInstallOptions {
  readonly arch?: string
  readonly homeDir?: string
  readonly log?: (message: string) => void
  readonly platform?: NodeJS.Platform
  readonly resolveBinary?: (options: SgResolverOptions) => SgResolution
  readonly provision?: (options: SgProvisionOptions) => Promise<string>
}

export async function installAstGrepForOpenCode(options: OpenCodeAstGrepInstallOptions = {}): Promise<void> {
  const homeDir = options.homeDir ?? homedir()
  const platform = options.platform ?? process.platform
  const arch = options.arch ?? process.arch
  const targetDir = astGrepRuntimeDir(join(homeDir, ".omo"), platform, arch)
  try {
    const existing = (options.resolveBinary ?? resolveSgBinarySync)({ homeDir, runtimeDir: targetDir, platform, arch, revalidate: true })
    if (existing.found) return
    await (options.provision ?? provisionSgBinary)({ platform, arch, targetDir })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    options.log?.(`[ast-grep] managed provisioning unavailable: ${message}`)
  }
}
