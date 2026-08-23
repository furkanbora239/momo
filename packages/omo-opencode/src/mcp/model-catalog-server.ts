// model-catalog-server.ts — the `catalog` stdio MCP server surface.
//
// Transport and sequential dispatch come from @oh-my-opencode/mcp-stdio-core.
// This module owns the catalog protocol shape: descriptors, lifecycle methods,
// and tools/call dispatch into the catalog query functions.
//
// Data source: the on-disk provider models cache that the plugin maintains via
// `updateConnectedProvidersCache` (client.provider.list() at session start). The
// path is supplied through OMO_CATALOG_CACHE_FILE; OMO_CATALOG_PREFER carries the
// optional `catalog.prefer` hints snapshot. catalog_refresh re-reads the file.

import { readFileSync } from "node:fs"
import type { Readable, Writable } from "node:stream"
import {
  errorResponse,
  isPlainRecord,
  jsonRpcId,
  runJsonRpcStdioServer,
  successResponse,
  type JsonRpcId,
  type JsonRpcResponse,
  type McpLifecycleLog,
  type McpToolDescriptor,
  type ParentWatchdogConfig,
} from "@oh-my-opencode/mcp-stdio-core"

export const CATALOG_SERVER_NAME = "catalog" as const
export const CATALOG_SERVER_VERSION = "0.1.0" as const
const DEFAULT_PROTOCOL_VERSION = "2024-11-05"

const CACHE_FILE_ENV = "OMO_CATALOG_CACHE_FILE"
const PREFER_ENV = "OMO_CATALOG_PREFER"

interface ModelEntry {
  id: string
  provider?: string
  name?: string
  context?: number
  output?: number
  modalities?: { input?: string[]; output?: string[] }
  capabilities?: Record<string, unknown>
  reasoning?: boolean
  temperature?: boolean
  tool_call?: boolean
}

interface ProviderModelsCache {
  models: Record<string, ModelEntry[]>
  connected?: string[]
  updatedAt?: string
}

type Capability = "vision" | "reasoning" | "tool_call"

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
  const haystack = `${model.id} ${model.name ?? ""}`.toLowerCase()
  if (/flash|mini|nano|lite|haiku|light/.test(haystack)) return "flash"
  if (/\bmax\b|ultra/.test(haystack)) return "max"
  if (/pro|opus/.test(haystack)) return "pro"
  return "default"
}

function hasCapability(model: ModelEntry, capability: Capability): boolean {
  switch (capability) {
    case "vision":
      return Array.isArray(model.modalities?.input) && model.modalities.input.includes("image")
    case "reasoning":
      return model.reasoning === true
    case "tool_call":
      return model.tool_call === true
  }
}

interface CatalogRow {
  id: string
  provider: string
  name: string
  tier: "flash" | "pro" | "max" | "default"
  context: number | null
  output: number | null
  vision: boolean
  reasoning: boolean
  tool_call: boolean
}

function flatten(cache: ProviderModelsCache): CatalogRow[] {
  const rows: CatalogRow[] = []
  for (const [provider, models] of Object.entries(cache.models)) {
    if (!Array.isArray(models)) continue
    for (const model of models) {
      if (typeof model?.id !== "string") continue
      rows.push({
        id: model.id,
        provider: model.provider ?? provider,
        name: model.name ?? model.id,
        tier: deriveTier(model),
        context: typeof model.context === "number" ? model.context : null,
        output: typeof model.output === "number" ? model.output : null,
        vision: hasCapability(model, "vision"),
        reasoning: hasCapability(model, "reasoning"),
        tool_call: hasCapability(model, "tool_call"),
      })
    }
  }
  return rows
}

export interface CatalogState {
  cacheFile: string | undefined
  prefer: Record<string, string[]>
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
  return { cacheFile, prefer }
}

function listCatalog(state: CatalogState, params: unknown): { rows: CatalogRow[]; updatedAt: string | null } {
  const cache = readCacheFile(state.cacheFile)
  if (!cache) return { rows: [], updatedAt: null }
  let rows = flatten(cache)
  if (isPlainRecord(params)) {
    const provider = typeof params["provider"] === "string" ? params["provider"] : undefined
    const capability = typeof params["capability"] === "string" ? (params["capability"] as Capability) : undefined
    const tier = typeof params["tier"] === "string" ? (params["tier"] as CatalogRow["tier"]) : undefined
    if (provider) rows = rows.filter((row) => row.provider === provider)
    if (capability) rows = rows.filter((row) => hasCapability(
      { id: row.id, modalities: row.vision ? { input: ["image"] } : undefined, reasoning: row.reasoning, tool_call: row.tool_call },
      capability,
    ))
    if (tier) rows = rows.filter((row) => row.tier === tier)
  }
  return { rows, updatedAt: cache.updatedAt ?? null }
}

const TIER_RANK: Record<CatalogRow["tier"], number> = { flash: 0, default: 1, pro: 2, max: 3 }

function pickCatalog(
  state: CatalogState,
  params: unknown,
): { picks: Array<{ id: string; provider: string; tier: CatalogRow["tier"]; reason: string }> } {
  const cache = readCacheFile(state.cacheFile)
  if (!cache) return { picks: [] }
  const need = isPlainRecord(params) && typeof params["need"] === "string" ? params["need"].toLowerCase() : "default"
  let rows = flatten(cache)

  const tierOrder: CatalogRow["tier"][] =
    need.includes("speed") || need.includes("fast") || need.includes("cheap")
      ? ["flash", "default", "pro", "max"]
      : need.includes("reason")
        ? ["pro", "max", "default", "flash"]
        : ["flash", "default", "pro", "max"]

  if (need.includes("vision")) rows = rows.filter((row) => row.vision)
  if (need.includes("reason")) rows = rows.filter((row) => row.reasoning)
  if (need.includes("tool")) rows = rows.filter((row) => row.tool_call)

  rows.sort((a, b) => {
    const rankDiff = tierOrder.indexOf(a.tier) - tierOrder.indexOf(b.tier)
    if (rankDiff !== 0) return rankDiff
    return TIER_RANK[a.tier] - TIER_RANK[b.tier]
  })

  const boosted = state.prefer[need]
  if (Array.isArray(boosted) && boosted.length > 0) {
    const boostSet = new Set(boosted)
    rows.sort((a, b) => Number(boostSet.has(b.id)) - Number(boostSet.has(a.id)))
  }

  const picks = rows.slice(0, 5).map((row) => ({
    id: row.id,
    provider: row.provider,
    tier: row.tier,
    reason: need.includes("vision")
      ? "vision-capable"
      : need.includes("reason")
        ? "reasoning-capable"
        : row.tier === "flash"
          ? "cheapest adequate"
          : "adequate",
  }))
  return { picks }
}

export const CATALOG_MCP_TOOLS: readonly McpToolDescriptor[] = [
  {
    name: "catalog_list",
    description:
      "List connected provider models with context window, output limit, vision, reasoning and tool_call tags. Optional filters: provider (id), capability (vision|reasoning|tool_call), tier (flash|pro|max|default).",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", description: "Filter by provider id (e.g. 'openai')." },
        capability: { type: "string", enum: ["vision", "reasoning", "tool_call"], description: "Filter by capability." },
        tier: { type: "string", enum: ["flash", "pro", "max", "default"], description: "Filter by model tier." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "catalog_pick",
    description:
      "Rank model ids for a need using local heuristics (no LLM call). need values: 'speed'/'fast'/'cheap' -> flash-class first; 'vision' -> vision models; 'reasoning' -> reasoning models; default -> cheapest adequate. Honors catalog.prefer boosts.",
    inputSchema: {
      type: "object",
      properties: {
        need: { type: "string", minLength: 1, description: "What the model is needed for." },
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
  if (method === "tools/list") return successResponse(id, { tools: [...CATALOG_MCP_TOOLS] })
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
