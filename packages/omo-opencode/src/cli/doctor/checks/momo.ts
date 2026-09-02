import { existsSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { validatePluginConfig } from "../../../config/validate"
import { getOmoOpenCodeCacheDir } from "../../../shared/data-path"
import { listSessionAdvisorBindings } from "../../../agents/advisor-binding"
import { resolveCodegraphDir } from "../../../hooks/repo-map-injector"
import type { CheckResult } from "../framework/types"

const CATALOG_CACHE_FILE = "provider-models.json"
const V1_ROSTER = ["sisyphus", "explore", "librarian", "advisor (when bound)"]

function readCachedModelCount(cacheFile: string): number | null {
  if (!existsSync(cacheFile)) return null
  try {
    const parsed = JSON.parse(readFileSync(cacheFile, "utf-8")) as { models?: Record<string, unknown[]> }
    if (!parsed.models) return 0
    return Object.values(parsed.models).reduce((sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0), 0)
  } catch {
    return null
  }
}

export function collectStaleDistIssue(distPath: string, srcPath: string): { title: string; description: string; severity: "warning" } | undefined {
  if (!existsSync(distPath) || !existsSync(srcPath)) return undefined
  if (statSync(srcPath).mtimeMs <= statSync(distPath).mtimeMs) return undefined
  return {
    title: "stale dist bundle (F7)",
    description: "packages/omo-opencode/src is newer than dist/index.js! OpenCode loads dist/index.js; run 'bun run build' to apply your latest changes.",
    severity: "warning",
  }
}

export async function checkMomORoster(): Promise<CheckResult> {
  const validation = validatePluginConfig(process.cwd())
  const config = validation.config

  const disabledMcps = config.disabled_mcps ?? []
  const catalogEnabled = !disabledMcps.includes("catalog")
  const cacheFile = join(getOmoOpenCodeCacheDir(), CATALOG_CACHE_FILE)
  const modelCount = readCachedModelCount(cacheFile)

  const advisorBound = config.agents?.advisor?.model !== undefined
  const disabledAgents = config.disabled_agents ?? []
  const sessionBindings = listSessionAdvisorBindings()

  const repoMapConfig = config.repo_map
  const repoMapEnabled = repoMapConfig?.enabled === true
  const codegraphDir = resolveCodegraphDir(process.cwd())
  const codegraphPresent = codegraphDir !== null

  const advisorStatus = advisorBound
    ? `config-bound to ${config.agents?.advisor?.model}`
    : "config-unbound"
  const sessionBindingNote = Object.keys(sessionBindings).length > 0
    ? `; session-bound: ${Object.entries(sessionBindings).map(([id, m]) => `${id}=${m}`).join(", ")}`
    : " (zero surprise cost)"

  const details = [
    `v1 roster (surfaced): ${V1_ROSTER.join(", ")}`,
    `catalog MCP: ${catalogEnabled ? "enabled" : "disabled"}${catalogEnabled ? ` (cached models: ${modelCount === null ? "no cache yet" : modelCount})` : ""}`,
    `advisor: ${advisorStatus}${sessionBindingNote}`,
    `repo map injector: ${repoMapEnabled ? "enabled" : "disabled"}${repoMapEnabled ? ` (token budget ${repoMapConfig?.token_budget ?? 1536})` : ""}; .codegraph: ${codegraphPresent ? "present" : "absent"}`,
    `disabled agents: ${disabledAgents.length === 0 ? "none" : disabledAgents.join(", ")}`,
  ]

  const issues: { title: string; description: string; severity: "error" | "warning" }[] = []
  if (catalogEnabled && modelCount === null) {
    issues.push({
      title: "catalog cache empty",
      description: "catalog cache not populated yet — start a session so client.provider.list() runs",
      severity: "warning",
    })
  }
  if (repoMapEnabled && !codegraphPresent) {
    issues.push({
      title: "repo map enabled but no index",
      description: "repo_map.enabled is true but no .codegraph/codegraph.db was found from the working directory — the injector will no-op until codegraph bootstraps an index",
      severity: "warning",
    })
  }

  const staleDistIssue = collectStaleDistIssue(
    join(process.cwd(), "dist", "index.js"),
    join(process.cwd(), "packages", "omo-opencode", "src", "index.ts"),
  )
  if (staleDistIssue) issues.push(staleDistIssue)

  return {
    name: "momo Roster & Catalog",
    status: issues.length === 0 ? "pass" : "warn",
    message: `momo: catalog ${catalogEnabled ? "on" : "off"}, advisor ${advisorBound ? "bound" : "unbound"}`,
    details,
    issues,
  }
}
