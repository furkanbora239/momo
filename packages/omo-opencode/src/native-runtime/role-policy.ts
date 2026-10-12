import { NATIVE_SEARCH_READ_TOOLS, NATIVE_SEARCH_WRITE_TOOLS, nativeSearchToolsForRole } from "../native-search/fallback"
import type { NativeRole } from "../native-routing/types"

export type NativeAgentID =
  | "momo-orchestrator" | "momo-planner" | "momo-executor" | "momo-reviewer"
  | "momo-worker" | "momo-explore" | "momo-librarian" | "momo-research"
  | "momo-catalog-researcher" | "momo-advisor"

const coordinators = new Set<NativeAgentID>(["momo-orchestrator", "momo-planner", "momo-executor", "momo-reviewer"])
const workers = new Set<NativeAgentID>(["momo-worker"])

export function ownedAgentID(value: string | undefined): NativeAgentID | undefined {
  if (value === undefined) return undefined
  return new Set<NativeAgentID>([
    "momo-orchestrator", "momo-planner", "momo-executor", "momo-reviewer", "momo-worker",
    "momo-explore", "momo-librarian", "momo-research", "momo-catalog-researcher", "momo-advisor",
  ]).has(value as NativeAgentID) ? value as NativeAgentID : undefined
}

export function nativeAgentPermissions(id: NativeAgentID): Array<{ action: string; resource: string; effect: "allow" | "deny" }> {
  const result: Array<{ action: string; resource: string; effect: "allow" | "deny" }> = [
    { action: "task", resource: "*", effect: "deny" },
    { action: "delegate_task", resource: "*", effect: "deny" },
    { action: "consult_advisor", resource: "*", effect: "deny" },
    { action: "momo_task", resource: "*", effect: coordinators.has(id) ? "allow" : "deny" },
    { action: "momo_consult", resource: "*", effect: id === "momo-advisor" ? "deny" : "allow" },
    { action: "momo_catalog_enrich", resource: "*", effect: id === "momo-catalog-researcher" ? "allow" : "deny" },
  ]
  for (const action of ["shell", "bash", "edit", "write", "apply_patch"]) {
    result.push({ action, resource: "*", effect: workers.has(id) ? "allow" : "deny" })
  }
  return result
}

export function nativeToolAllowed(id: NativeAgentID, tool: "momo_task" | "momo_consult"): boolean {
  return tool === "momo_task" ? coordinators.has(id) : id !== "momo-advisor"
}

const readTools = new Set([
  "read", "glob", "grep", "list", "search", "webfetch", "websearch", "codesearch",
  "catalog_list", "catalog_pick", "catalog_knowledge", "lsp_diagnostics", "lsp_definition",
  "lsp_references", "lsp_hover", "lsp_symbols", "lsp_document_symbols", "lsp_workspace_symbols",
  "get_architecture", "trace_path",
  "status", "diagnostics", "goto_definition", "find_references", "symbols", "scan",
])
const nativeSearchReadTools = new Set<string>(NATIVE_SEARCH_READ_TOOLS.map((name) => name.toLowerCase()))
const nativeSearchWriteTools = new Set<string>(NATIVE_SEARCH_WRITE_TOOLS.map((name) => name.toLowerCase()))

const nativeSearchServers = ["momo_ast_grep", "momo_lsp"] as const

export function normalizeNativeSearchToolName(name: string): string {
  const normalized = name.toLowerCase()
  for (const server of nativeSearchServers) {
    const canonicalPrefix = `mcp__${server}__`
    if (normalized.startsWith(canonicalPrefix)) return normalized
    const runtimePrefixes = [`${server}_`, `${server}.`, `mcp__${server}_`, `mcp__${server}.`]
    for (const prefix of runtimePrefixes) {
      if (normalized.startsWith(prefix)) return `${canonicalPrefix}${normalized.slice(prefix.length)}`
    }
  }
  return normalized
}

function isNativeSearchTool(name: string): boolean {
  const normalized = normalizeNativeSearchToolName(name)
  return nativeSearchReadTools.has(normalized) || nativeSearchWriteTools.has(normalized)
}

function nativeSearchToolAllowed(id: NativeAgentID, name: string): boolean {
  const role = id.slice("momo-".length) as NativeRole
  const normalized = normalizeNativeSearchToolName(name)
  return nativeSearchToolsForRole(role).some((tool) => tool.toLowerCase() === normalized)
}

export function isNativeReadTool(name: string): boolean {
  const canonical = normalizeNativeSearchToolName(name)
  const normalized = canonical.split("__").at(-1) ?? canonical
  return readTools.has(normalized) || nativeSearchReadTools.has(canonical) || /^(?:mcp_)?(?:read|search|list|find|fetch|query)(?:_|$)/.test(normalized)
}

export function nativeActionEffect(id: NativeAgentID, action: string): "allow" | "deny" | undefined {
  const name = action.toLowerCase()
  if (name === "execute") return undefined
  if (name === "momo_task") return coordinators.has(id) ? "allow" : "deny"
  if (name === "momo_consult") return id === "momo-advisor" ? "deny" : "allow"
  if (name === "momo_catalog_enrich") return id === "momo-catalog-researcher" ? "allow" : "deny"
  if (isNativeSearchTool(name)) return nativeSearchToolAllowed(id, name) ? undefined : "deny"
  if (name === "task" || name.includes("subagent") || name.includes("delegate") || name.startsWith("momo_task_")) return "deny"
  if (id === "momo-advisor") return isNativeReadTool(name) ? undefined : "deny"
  if (id === "momo-catalog-researcher" && name !== "execute" && name !== "momo_catalog_enrich" && !isNativeReadTool(name)) return "deny"
  if (id === "momo-catalog-researcher" && /(?:shell|bash|edit|write|apply_patch|rename|codeaction|manage_adr|create_file|delete)/.test(name)) return "deny"
  if (coordinators.has(id) && /(?:shell|bash|edit|write|apply_patch|rename|codeaction|manage_adr|create_file|delete)/.test(name)) return "deny"
  return undefined
}

export function filterNativeContextTools(agent: string | undefined, tools: Record<string, unknown>, activeOwnedIDs?: ReadonlySet<string>): void {
  if (agent !== undefined && activeOwnedIDs !== undefined && !activeOwnedIDs.has(agent)) return
  const role = ownedAgentID(agent)
  if (!role) return
  for (const name of Object.keys(tools)) {
    const normalized = name.toLowerCase()
    if (role === "momo-advisor" && normalized !== "execute" && !isNativeReadTool(normalized)) delete tools[name]
    if (role === "momo-catalog-researcher" && normalized !== "execute" && normalized !== "momo_catalog_enrich" && !isNativeReadTool(normalized)) delete tools[name]
    if (isNativeSearchTool(normalized) && !nativeSearchToolAllowed(role, normalized)) delete tools[name]
    if (/(?:^|__)(?:task|subagent|delegate)(?:$|__)/.test(normalized) && normalized !== "momo_task" && normalized !== "momo_consult") delete tools[name]
    if (normalized.startsWith("momo_task_") || normalized.startsWith("momo_consult_")) delete tools[name]
    if (normalized === "momo_catalog_enrich" && role !== "momo-catalog-researcher") delete tools[name]
    if (role === "momo-catalog-researcher" && normalized === "momo_catalog_enrich") continue
    if (normalized === "momo_task" && !nativeToolAllowed(role, "momo_task")) delete tools[name]
    if (normalized === "momo_consult" && !nativeToolAllowed(role, "momo_consult")) delete tools[name]
    if (coordinators.has(role) && /(?:shell|bash|edit|write|apply_patch|rename|codeaction|manage_adr|create_file|delete)/.test(normalized)) delete tools[name]
  }
}
