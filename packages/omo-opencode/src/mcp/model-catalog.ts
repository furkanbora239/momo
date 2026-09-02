import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { getOmoOpenCodeCacheDir } from "../shared/data-path"
import { resolveRuntimeExecutable, type RuntimeExecutableResolver } from "./runtime-executable"
import { createAncestorCliCandidates, type AncestorCliCandidate } from "./shared/ancestor-cli-resolver"
import { hasCliSuffix } from "./cli-suffix"
import type { LocalMcpConfig } from "./lsp"

const PACKAGE_REL = "packages/omo-opencode"
const SOURCE_CLI_REL = "src/mcp/model-catalog-cli.ts"
const DIST_CLI_REL = "dist/mcp/model-catalog-cli.js"
const CACHE_FILENAME = "provider-models.json"

export type CatalogPrefer = Record<string, string | string[]>

export type CatalogMcpConfigOptions = {
  readonly cacheFile?: string
  readonly prefer?: CatalogPrefer
  readonly preferProviders?: readonly string[]
  readonly resolveExecutable?: RuntimeExecutableResolver
  readonly moduleUrl?: string
  readonly exists?: (path: string) => boolean
}

function normalizePrefer(prefer: CatalogPrefer | undefined): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  if (!prefer) return result
  for (const [key, value] of Object.entries(prefer)) {
    result[key] = typeof value === "string" ? [value] : value
  }
  return result
}

function resolveCatalogCommand(options: CatalogMcpConfigOptions = {}): AncestorCliCandidate {
  const pathExists = options.exists ?? ((path: string) => existsSync(path))
  const resolveExecutable = options.resolveExecutable ?? resolveRuntimeExecutable
  const moduleDirectory = options.moduleUrl
    ? dirname(fileURLToPath(options.moduleUrl))
    : dirname(fileURLToPath(import.meta.url))
  const candidates = createAncestorCliCandidates({
    startDirectory: moduleDirectory,
    packageRel: PACKAGE_REL,
    distCliRel: DIST_CLI_REL,
    sourceCliRel: SOURCE_CLI_REL,
    pathExists,
    resolveExecutable,
  })
  const distCandidate = candidates.find((candidate) => hasCliSuffix(candidate.path, DIST_CLI_REL) && candidate.exists)
  if (distCandidate) return distCandidate
  const sourceCandidate = candidates.find((candidate) => hasCliSuffix(candidate.path, SOURCE_CLI_REL) && candidate.exists)
  if (sourceCandidate) return sourceCandidate
  return candidates[0]
}

export function createCatalogMcpConfig(options: CatalogMcpConfigOptions = {}): LocalMcpConfig {
  const resolvedCommand = resolveCatalogCommand(options)
  const cacheFile = options.cacheFile ?? join(getOmoOpenCodeCacheDir(), CACHE_FILENAME)
  return {
    type: "local",
    command: resolvedCommand.command,
    enabled: resolvedCommand.exists,
    environment: {
      OMO_CATALOG_CACHE_FILE: cacheFile,
      OMO_CATALOG_PREFER: JSON.stringify(normalizePrefer(options.prefer)),
      OMO_CATALOG_PREFER_PROVIDERS: (options.preferProviders ?? []).join(","),
    },
  }
}
