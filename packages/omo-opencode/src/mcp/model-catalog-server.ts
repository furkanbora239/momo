// model-catalog-server.ts — the `catalog` stdio MCP server surface.
//
// Transport and sequential dispatch come from @oh-my-opencode/mcp-stdio-core.
// This module owns the catalog protocol shape: descriptors, lifecycle methods,
// and tools/call dispatch into the catalog query functions.
//
// Data source: the on-disk provider models cache that the plugin maintains via
// `updateConnectedProvidersCache` (client.provider.list() at session start). The
// path is supplied through OMO_CATALOG_CACHE_FILE; OMO_CATALOG_PREFER carries the
// optional `catalog.prefer` hints snapshot and OMO_CATALOG_PREFER_PROVIDERS the
// comma-separated `catalog.prefer_providers` boost list. catalog_refresh re-reads
// the file.

import { readFileSync } from "node:fs"
import type { Readable, Writable } from "node:stream"
import {
  getModelProfile,
  readRuntimeModelCost,
  readRuntimeModelLimitContext,
  readRuntimeModelLimitOutput,
  readRuntimeModelModalities,
  readRuntimeModelReasoningSupport,
  readRuntimeModelToolCallSupport,
} from "@oh-my-opencode/model-core"
import {
  errorResponse,
  isPlainRecord,
  jsonRpcId,
  pruneToolDescriptors,
  runJsonRpcStdioServer,
  successResponse,
  type JsonRpcId,
  type JsonRpcResponse,
  type McpLifecycleLog,
  type McpToolDescriptor,
  type ParentWatchdogConfig,
} from "@oh-my-opencode/mcp-stdio-core"

export const CATALOG_SERVER_NAME = "catalog" as const
export const CATALOG_SERVER_VERSION = "0.2.0" as const
const DEFAULT_PROTOCOL_VERSION = "2024-11-05"

const CACHE_FILE_ENV = "OMO_CATALOG_CACHE_FILE"
const PREFER_ENV = "OMO_CATALOG_PREFER"
const PREFER_PROVIDERS_ENV = "OMO_CATALOG_PREFER_PROVIDERS"

type ModelEntry = Record<string, unknown>

interface ProviderModelsCache {
  models: Record<string, ModelEntry[]>
  connected?: string[]
  updatedAt?: string
}

type Capability = "vision" | "reasoning" | "tool_call"
type CostTier = "budget" | "balanced" | "premium"

interface Pricing {
  input_per_m: number
  output_per_m: number
  currency: "USD"
}

function readCacheFile(cacheFile: string | undefined): ProviderModelsCache | null {
  if (!cacheFile) return null
  try {
    const parsed = JSON.parse(readFileSync(cacheFile, "utf-8")) as ProviderModelsCache
    if (!isPlainRecord(parsed) || !isPlainRecord(parsed.models)) return null
    return parsed
  } catch {
    return null
  }
}

function deriveTier(model: ModelEntry): "flash" | "pro" | "max" | "default" {
  const haystack = `${String(model.id ?? "")} ${String(model.name ?? "")}`.toLowerCase()
  if (/flash|mini|nano|lite|haiku|light/.test(haystack)) return "flash"
  if (/\bmax\b|ultra/.test(haystack)) return "max"
  if (/pro|opus/.test(haystack)) return "pro"
  return "default"
}

const PREMIUM_BLENDED_PER_M = 8
const BUDGET_BLENDED_PER_M = 1.5

function deriveCostTier(pricing: Pricing | null): CostTier | null {
  if (!pricing) return null
  const blended = (pricing.input_per_m + pricing.output_per_m) / 2
  if (blended < BUDGET_BLENDED_PER_M) return "budget"
  if (blended < PREMIUM_BLENDED_PER_M) return "balanced"
  return "premium"
}

function derivePricing(model: ModelEntry): Pricing | null {
  const cost = readRuntimeModelCost(model)
  if (!cost || typeof cost.input !== "number" || typeof cost.output !== "number") return null
  return { input_per_m: cost.input, output_per_m: cost.output, currency: "USD" }
}

function deriveStrengths(input: {
  tier: "flash" | "pro" | "max" | "default"
  costTier: CostTier | null
  vision: boolean
  reasoning: boolean
  toolCall: boolean
}): { strengths: string[]; weaknesses: string[] } {
  const strengths: string[] = []
  const weaknesses: string[] = []
  if (input.reasoning) strengths.push("complex_reasoning", "multi_step_planning")
  else weaknesses.push("deep_reasoning")
  if (input.toolCall) strengths.push("tool_orchestration")
  else weaknesses.push("long_tool_loops")
  if (input.vision) strengths.push("visual_analysis")
  if (input.tier === "flash") strengths.push("fast_iteration")
  if (input.costTier === "budget") strengths.push("bulk_low_cost_work")
  if (input.tier === "max" || input.tier === "pro" || input.costTier === "premium") {
    strengths.push("hard_architecture_decisions")
    weaknesses.push("high_cost_for_simple_tasks")
  }
  return { strengths: strengths.slice(0, 4), weaknesses: weaknesses.slice(0, 3) }
}

function hasCapability(model: ModelEntry, capability: Capability): boolean {
  switch (capability) {
    case "vision": {
      const modalities = readRuntimeModelModalities(model)
      return modalities?.input?.includes("image") ?? false
    }
    case "reasoning":
      return readRuntimeModelReasoningSupport(model) === true
    case "tool_call":
      return readRuntimeModelToolCallSupport(model) === true
  }
}

interface CatalogRow {
  id: string
  provider: string
  name: string
  family: string | null
  tier: "flash" | "pro" | "max" | "default"
  context_window: number | null
  output: number | null
  pricing: Pricing | null
  cost_tier: CostTier | null
  description?: string
  strengths: string[]
  weaknesses: string[]
  best_for?: string[]
  recommended_roles?: string[]
  vision: boolean
  reasoning: boolean
  tool_call: boolean
  text_output: boolean | null
  release_date: string | null
}

function readReleaseDate(model: ModelEntry): string | null {
  const value = model["release_date"]
  return typeof value === "string" && value.length > 0 ? value : null
}

function flatten(cache: ProviderModelsCache): CatalogRow[] {
  const rows: CatalogRow[] = []
  for (const [provider, models] of Object.entries(cache.models)) {
    if (!Array.isArray(models)) continue
    for (const model of models) {
      if (typeof model?.id !== "string") continue
      const tier = deriveTier(model)
      const pricing = derivePricing(model)
      const costTier = deriveCostTier(pricing)
      const vision = hasCapability(model, "vision")
      const reasoning = hasCapability(model, "reasoning")
      const toolCall = hasCapability(model, "tool_call")
      const modalities = readRuntimeModelModalities(model)
      const textOutput = modalities?.output ? modalities.output.includes("text") : null
      const profile = getModelProfile(model.id)
      const genericStrengths = deriveStrengths({ tier, costTier, vision, reasoning, toolCall })
      const strengths = profile ? [...profile.strengths] : genericStrengths.strengths
      const weaknesses = profile ? [...profile.weaknesses] : genericStrengths.weaknesses
      const bestFor = profile ? [...profile.bestUseCases] : []
      const recommendedRoles = profile ? [profile.primaryRole, ...profile.secondaryRoles] : []

      rows.push({
        id: model.id,
        provider: typeof model.providerID === "string" ? model.providerID : provider,
        name: typeof model.name === "string" ? model.name : model.id,
        family: typeof model.family === "string" ? model.family : (profile?.family ?? null),
        tier,
        context_window: readRuntimeModelLimitContext(model) ?? profile?.benchmarks.contextWindowTokens ?? null,
        output: readRuntimeModelLimitOutput(model) ?? profile?.benchmarks.maxOutputTokens ?? null,
        pricing,
        cost_tier: costTier,
        description: profile?.description,
        strengths,
        weaknesses,
        best_for: bestFor.length > 0 ? bestFor : undefined,
        recommended_roles: recommendedRoles.length > 0 ? recommendedRoles : undefined,
        vision,
        reasoning: reasoning || (profile?.benchmarks.reasoningSupported ?? false),
        tool_call: toolCall,
        text_output: textOutput,
        release_date: readReleaseDate(model),
      })
    }
  }
  return rows
}

export interface CatalogState {
  cacheFile: string | undefined
  prefer: Record<string, string[]>
  readonly preferProviders: string[]
}

function parsePreferProviders(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0)
}

function loadState(): CatalogState {
  const cacheFile = process.env[CACHE_FILE_ENV] || undefined
  let prefer: Record<string, string[]> = {}
  const rawPrefer = process.env[PREFER_ENV]
  if (rawPrefer) {
    try {
      const parsed = JSON.parse(rawPrefer) as Record<string, unknown>
      if (isPlainRecord(parsed)) {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === "string") prefer[key] = [value]
          else if (Array.isArray(value) && value.every((v) => typeof v === "string")) prefer[key] = value
        }
      }
    } catch {
      prefer = {}
    }
  }
  return {
    cacheFile,
    prefer,
    preferProviders: parsePreferProviders(process.env[PREFER_PROVIDERS_ENV]),
  }
}

function listCatalog(state: CatalogState, params: unknown): { rows: CatalogRow[]; updatedAt: string | null } {
  const cache = readCacheFile(state.cacheFile)
  if (!cache) return { rows: [], updatedAt: null }
  let rows = flatten(cache)
  if (isPlainRecord(params)) {
    const provider = typeof params["provider"] === "string" ? params["provider"] : undefined
    const capability = typeof params["capability"] === "string" ? (params["capability"] as Capability) : undefined
    const tier = typeof params["tier"] === "string" ? (params["tier"] as CatalogRow["tier"]) : undefined
    const costTier = typeof params["cost_tier"] === "string" ? (params["cost_tier"] as CostTier) : undefined
    if (provider) rows = rows.filter((row) => row.provider === provider)
    if (capability) rows = rows.filter((row) => hasCapability(toModelEntry(row), capability))
    if (tier) rows = rows.filter((row) => row.tier === tier)
    if (costTier) rows = rows.filter((row) => row.cost_tier === costTier)
  }
  return { rows, updatedAt: cache.updatedAt ?? null }
}

function toModelEntry(row: CatalogRow): ModelEntry {
  return {
    id: row.id,
    name: row.name,
    capabilities: {
      reasoning: row.reasoning,
      toolcall: row.tool_call,
      input: { image: row.vision },
    },
  }
}

const TIER_RANK: Record<CatalogRow["tier"], number> = { flash: 0, default: 1, pro: 2, max: 3 }

type BudgetProfile = "low_cost" | "balanced" | "max_performance"
type TaskComplexity = "trivial" | "moderate" | "complex"

function blendedPrice(row: CatalogRow): number {
  if (!row.pricing) return Number.POSITIVE_INFINITY
  return (row.pricing.input_per_m + row.pricing.output_per_m) / 2
}

function sweBenchScore(row: CatalogRow): number | null {
  return getModelProfile(row.id)?.benchmarks.sweBenchScorePercentEst ?? null
}

function sweBenchDiff(a: CatalogRow, b: CatalogRow): number {
  const aScore = sweBenchScore(a)
  const bScore = sweBenchScore(b)
  if (aScore === null && bScore === null) return 0
  if (aScore === null) return 1
  if (bScore === null) return -1
  return bScore - aScore
}

function priceDiff(a: CatalogRow, b: CatalogRow): number {
  const aPrice = blendedPrice(a)
  const bPrice = blendedPrice(b)
  if (aPrice === bPrice) return 0
  return aPrice - bPrice
}

function matchesRoleNeed(row: CatalogRow, need: string): boolean {
  if (!row.recommended_roles || row.recommended_roles.length === 0) return false
  const n = need.toLowerCase()
  if ((n.includes("plan") || n === "lead_planner") && row.recommended_roles.includes("lead_planner")) return true
  if ((n.includes("exec") || n === "lead_executor" || n.includes("code")) && row.recommended_roles.includes("lead_executor")) return true
  if ((n.includes("review") || n === "lead_reviewer" || n.includes("audit")) && row.recommended_roles.includes("lead_reviewer")) return true
  if ((n.includes("research") || n === "worker_research" || n.includes("librar")) && row.recommended_roles.includes("worker_research")) return true
  if ((n.includes("explore") || n === "worker_explore" || n.includes("grep")) && row.recommended_roles.includes("worker_explore")) return true
  if ((n.includes("quick") || n === "worker_quick" || n.includes("patch")) && row.recommended_roles.includes("worker_quick")) return true
  if ((n.includes("visual") || n === "worker_visual") && row.recommended_roles.includes("worker_visual")) return true
  return false
}

function pickCatalog(
  state: CatalogState,
  params: unknown,
): { picks: Array<{ id: string; provider: string; tier: CatalogRow["tier"]; cost_tier: CostTier | null; pricing: Pricing | null; reason: string; description?: string; best_for?: string[]; recommended_roles?: string[]; weaknesses: string[] }> } {
  const cache = readCacheFile(state.cacheFile)
  if (!cache) return { picks: [] }
  const need = isPlainRecord(params) && typeof params["need"] === "string" ? params["need"].toLowerCase() : "default"
  const budgetProfile: BudgetProfile =
    isPlainRecord(params) && typeof params["budget_profile"] === "string"
      ? (params["budget_profile"] as BudgetProfile)
      : "balanced"
  const taskComplexity: TaskComplexity =
    isPlainRecord(params) && typeof params["task_complexity"] === "string"
      ? (params["task_complexity"] as TaskComplexity)
      : "moderate"
  let rows = flatten(cache)

  const tierOrder: CatalogRow["tier"][] =
    budgetProfile === "max_performance" || taskComplexity === "complex"
      ? ["pro", "max", "default", "flash"]
      : budgetProfile === "low_cost" || taskComplexity === "trivial"
        ? ["flash", "default", "pro", "max"]
        : need.includes("speed") || need.includes("fast") || need.includes("cheap")
          ? ["flash", "default", "pro", "max"]
          : need.includes("reason")
            ? ["pro", "max", "default", "flash"]
            : ["flash", "default", "pro", "max"]

  if (need.includes("vision")) rows = rows.filter((row) => row.vision)
  if (need.includes("reason")) rows = rows.filter((row) => row.reasoning)
  if (need.includes("tool")) rows = rows.filter((row) => row.tool_call)
  if (taskComplexity === "complex") rows = rows.filter((row) => row.reasoning)
  const mediaNeed = /image|audio|video|tts|speech|music|voice|embedding|rerank|transcri/.test(need)
  if (!mediaNeed) rows = rows.filter((row) => row.tool_call)
  if (!mediaNeed) rows = rows.filter((row) => row.text_output !== false)

  const connectedIds = new Set(rows.map((row) => row.id))
  const supersededIds = new Set(
    rows
      .filter((row) => {
        const successor = getModelProfile(row.id)?.supersededBy
        return typeof successor === "string" && successor !== row.id && connectedIds.has(successor)
      })
      .map((row) => row.id),
  )

  const boosted = state.prefer[need]
  const preferBoostSet = Array.isArray(boosted) ? new Set(boosted) : new Set<string>()
  const providerBoostSet = new Set(state.preferProviders)

  rows.sort((a, b) => {
    const preferDiff = Number(preferBoostSet.has(b.id)) - Number(preferBoostSet.has(a.id))
    if (preferDiff !== 0) return preferDiff

    // Demote superseded models whose successor is connected
    const supersededDiff = Number(supersededIds.has(a.id)) - Number(supersededIds.has(b.id))
    if (supersededDiff !== 0) return supersededDiff

    // Role affinity boost if need maps to a known role
    const aRole = matchesRoleNeed(a, need) ? 1 : 0
    const bRole = matchesRoleNeed(b, need) ? 1 : 0
    if (bRole !== aRole) return bRole - aRole

    const rankDiff = tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier)
    if (rankDiff !== 0) return rankDiff
    const tierDiff = TIER_RANK[a.tier] - TIER_RANK[b.tier]
    if (tierDiff !== 0) return tierDiff
    const providerDiff = Number(providerBoostSet.has(b.provider.toLowerCase())) - Number(providerBoostSet.has(a.provider.toLowerCase()))
    if (providerDiff !== 0) return providerDiff

    if (budgetProfile === "max_performance") {
      const capabilityDiff = Number(b.reasoning) + Number(b.tool_call) - (Number(a.reasoning) + Number(a.tool_call))
      if (capabilityDiff !== 0) return capabilityDiff
      const sweDiff = sweBenchDiff(a, b)
      if (sweDiff !== 0) return sweDiff
      return priceDiff(a, b)
    }
    const costDiff = priceDiff(a, b)
    if (costDiff !== 0) return costDiff
    const sweDiff = sweBenchDiff(a, b)
    if (sweDiff !== 0) return sweDiff

    // LAST tie-break only: prefer the neuralwatt provider for complex tasks
    // (orchestrator cache synergy); fires only when rows are otherwise fully equal
    if (taskComplexity === "complex") {
      const aIsNw = a.provider.toLowerCase() === "neuralwatt" ? 1 : 0
      const bIsNw = b.provider.toLowerCase() === "neuralwatt" ? 1 : 0
      if (bIsNw !== aIsNw) return bIsNw - aIsNw
    }
    return 0
  })

  const picks = rows.slice(0, 5).map((row) => ({
    id: row.id,
    provider: row.provider,
    tier: row.tier,
    cost_tier: row.cost_tier,
    pricing: row.pricing,
    description: row.description,
    best_for: row.best_for,
    recommended_roles: row.recommended_roles,
    weaknesses: row.weaknesses,
    reason: need.includes("vision")
      ? "vision-capable"
      : need.includes("reason") || taskComplexity === "complex"
        ? "reasoning-capable"
        : row.tier === "flash" || taskComplexity === "trivial"
          ? "cheapest adequate"
          : "adequate",
  }))
  return { picks }
}

export const CATALOG_MCP_TOOLS: readonly McpToolDescriptor[] = [
  {
    name: "catalog_list",
    description:
      "List connected provider models with pricing (USD per million tokens), cost_tier (budget|balanced|premium), context_window, output limit, vision, reasoning and tool_call tags, strengths and weaknesses. Optional filters: provider (id), capability (vision|reasoning|tool_call), tier (flash|pro|max|default), cost_tier.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Filter by provider id (e.g. 'openai')." },
        capability: { type: "string", enum: ["vision", "reasoning", "tool_call"], description: "Filter by capability." },
        tier: { type: "string", enum: ["flash", "pro", "max", "default"], description: "Filter by model tier." },
        cost_tier: { type: "string", enum: ["budget", "balanced", "premium"], description: "Filter by cost tier." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "catalog_pick",
    description:
      "Rank model ids for a need using local heuristics (no LLM call). need values: 'speed'/'fast'/'cheap' -> flash-class first; 'vision' -> vision models; 'reasoning' -> reasoning models; default -> cheapest adequate. Agent picks require tool_call-capable models unless the need explicitly asks for media, embedding or rerank work. Optional budget_profile ('low_cost'|'balanced'|'max_performance') and task_complexity ('trivial'|'moderate'|'complex', complex requires reasoning-capable). Honors catalog.prefer boosts, then catalog.prefer_providers, then price.",
    inputSchema: {
      type: "object",
      properties: {
        need: { type: "string", minLength: 1, description: "What the model is needed for." },
        budget_profile: {
          type: "string",
          enum: ["low_cost", "balanced", "max_performance"],
          description: "Cost preference: low_cost sorts cheapest first, max_performance sorts most capable first.",
        },
        task_complexity: {
          type: "string",
          enum: ["trivial", "moderate", "complex"],
          description: "Complex drives reasoning-capable models only; trivial prefers the cheapest tier.",
        },
      },
      required: ["need"],
      additionalProperties: false,
    },
  },
  {
    name: "catalog_refresh",
    description: "Re-read the on-disk provider models cache (populated by the plugin from client.provider.list()). Returns the updated snapshot metadata.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
]

export interface CatalogMcpOptions {
  readonly lifecycleLog?: McpLifecycleLog
  readonly parentWatchdog?: ParentWatchdogConfig
}

export async function handleCatalogRequest(
  input: unknown,
  state: CatalogState,
): Promise<JsonRpcResponse | undefined> {
  if (!isPlainRecord(input)) return errorResponse(null, -32600, "Invalid Request")

  const id = jsonRpcId(input["id"])
  const method = input["method"]

  if (method === "notifications/initialized") return undefined
  if (method === "ping") return successResponse(id, {})
  if (method === "initialize") {
    return successResponse(id, {
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: CATALOG_SERVER_NAME, version: CATALOG_SERVER_VERSION },
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
    })
  }
  if (method === "tools/list") return successResponse(id, { tools: pruneToolDescriptors([...CATALOG_MCP_TOOLS]) })
  if (method === "tools/call") return handleToolCall(id, input["params"], state)

  return errorResponse(id, -32601, `Method not found: ${String(method)}`)
}

async function handleToolCall(id: JsonRpcId, params: unknown, state: CatalogState): Promise<JsonRpcResponse> {
  if (!isPlainRecord(params) || typeof params["name"] !== "string") {
    return errorResponse(id, -32602, "tools/call requires params.name")
  }
  const name = params["name"]
  const args = isPlainRecord(params["arguments"]) ? params["arguments"] : {}

  try {
    if (name === "catalog_list") {
      const { rows, updatedAt } = listCatalog(state, args)
      return toolResponse(id, { updatedAt, count: rows.length, models: rows }, false)
    }
    if (name === "catalog_pick") {
      return toolResponse(id, pickCatalog(state, args), false)
    }
    if (name === "catalog_refresh") {
      const cache = readCacheFile(state.cacheFile)
      const rows = cache ? flatten(cache) : []
      return toolResponse(
        id,
        { refreshed: true, updatedAt: cache?.updatedAt ?? null, providerCount: cache ? Object.keys(cache.models).length : 0, modelCount: rows.length },
        false,
      )
    }
    return toolResponse(id, { error: `Unknown catalog tool: ${name}` }, true)
  } catch (error) {
    return toolResponse(id, { error: error instanceof Error ? error.message : String(error) }, true)
  }
}

function toolResponse(id: JsonRpcId, payload: unknown, isError: boolean): JsonRpcResponse {
  return successResponse(id, {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    isError,
  })
}

export async function runCatalogStdioServer(
  input: Readable = process.stdin,
  output: Writable = process.stdout,
  options: CatalogMcpOptions = {},
): Promise<void> {
  const state = loadState()
  await runJsonRpcStdioServer({
    input,
    output,
    handler: (request) => handleCatalogRequest(request, state),
    handlerOptions: undefined,
    idleTimeoutMs: 0,
    parentWatchdog: options.parentWatchdog ?? {},
    log: options.lifecycleLog,
  })
}
