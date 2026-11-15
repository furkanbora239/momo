// MODIFIED: prepare the pinned runtime on first use without delaying MCP discovery.
import { homedir } from "node:os"
import { join } from "node:path"
import { astGrepRuntimeDir, provisionSgBinary, resolveSgBinarySync, type SgResolution } from "@oh-my-opencode/utils"

interface ManagedSgDependencies {
  readonly resolve: () => SgResolution
  readonly provision: (signal?: AbortSignal) => Promise<string>
}

export function createManagedSgResolver(overrides: Partial<ManagedSgDependencies> = {}) {
  const dependencies: ManagedSgDependencies = {
    resolve: () => resolveSgBinarySync({ revalidate: true }),
    provision: (signal) => provisionSgBinary({ targetDir: astGrepRuntimeDir(join(homedir(), ".omo")), signal }),
    ...overrides,
  }
  let preparing: Promise<string> | undefined
  return async (signal?: AbortSignal): Promise<string> => {
    signal?.throwIfAborted()
    const existing = dependencies.resolve()
    if (existing.found) return existing.path
    if (!preparing) {
      preparing = (async () => {
        await dependencies.provision(signal)
        signal?.throwIfAborted()
        const installed = dependencies.resolve()
        if (!installed.found) throw Object.assign(new Error(installed.error.message), { hints: installed.error.hints })
        return installed.path
      })().finally(() => { preparing = undefined })
    }
    return preparing
  }
}
