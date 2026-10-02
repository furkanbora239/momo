import {
  buildEffortQuestion,
  buildLaneQuestion,
  buildModelQuestion,
  buildPathQuestion,
  createDecisionEngine,
  createJevClient,
  type BuildCandidatesContext,
  type DecisionEngine,
  type DecisionResult,
  type DecisionTask,
  type ModelCandidate,
  type PathOption,
} from "@oh-my-opencode/decision-core"
import {
  CATEGORY_MODEL_REQUIREMENTS,
  getModelProfile,
  type ModelCostTier,
} from "@oh-my-opencode/model-core"
import {
  resolveModelForDelegateTask as resolveModelForDelegateTaskCore,
} from "@oh-my-opencode/delegate-core"

import { getAvailableModelsForDelegateTask } from "./available-models"
import type { OpencodeClient } from "./types"
import { isModelAllowed, readModelPool, type ModelPool } from "../../shared/model-pool"
import { readModelKnowledge } from "../../shared/catalog-knowledge"
import { getProviderApiKey } from "../../shared/opencode-provider-auth"
import { log } from "../../shared/logger"
import {
  createDecisionLedger,
  type DecisionLedger,
  type DecisionLedgerRecordInput,
} from "../../features/decision-ledger/ledger"
import { PROMPT_EXCERPT_CAP } from "../../features/decision-ledger/types"
import type { ManagerConfig } from "../../config/schema/decision-engine"

export const DEFAULT_ZEN_PROVIDER = "opencode-go"

export interface DecisionRouterRewrite {
  category?: string
  subagent_type?: string
  model?: string
}

export interface DecisionRouterResult {
  source: "jev" | "fallback"
  reason?: string
  rewrite: DecisionRouterRewrite
  decisionId?: string
}

export interface DecisionRouterOutcome {
  status: "success" | "failure" | "timeout" | "overridden"
  durationMs: number
  overrideReason?: string
  notes?: string
}

export interface DecisionRouterDeps {
  client: OpencodeClient
  config: ManagerConfig
  ledger?: DecisionLedger
  sessionId?: string
  getApiKey?: () => string | Promise<string>
  modelPoolOverride?: ModelPool
  /** Injected for tests; bypasses Jev client + candidate snapshot. */
  engine?: DecisionEngine
  /** Injected for tests; bypasses live model discovery. */
  buildCandidatesImpl?: (ctx: BuildCandidatesContext) => readonly ModelCandidate[]
  /** Injected for tests; overrides the live available-model set used for fallback rescue. */
  availableModelsOverride?: ReadonlySet<string>
}

const TIER_PRICE: Record<ModelCostTier, number> = {
  free: 0,
  budget: 0.04,
  balanced: 0.4,
  premium: 4,
}

const PATH_OPTIONS: PathOption[] = [
  { name: "quick", description: "Trivial single-file edits, typos, simple modifications" },
  { name: "explore", description: "Codebase search, symbol/reference tracing, file discovery" },
  { name: "librarian", description: "External docs, library APIs, web research" },
  { name: "research", description: "Deep research requiring synthesis across sources" },
  { name: "planner", description: "High-reasoning read-only planning before implementation" },
  { name: "executor", description: "Direct implementation of an approved plan" },
  { name: "reviewer", description: "Audit changes, run verification, check edge cases/security" },
]

const PATH_REWRITE: Record<string, DecisionRouterRewrite> = {
  quick: { category: "quick" },
  explore: { subagent_type: "explore" },
  librarian: { subagent_type: "librarian" },
  research: { subagent_type: "research" },
  planner: { subagent_type: "planner" },
  executor: { subagent_type: "executor" },
  reviewer: { subagent_type: "reviewer" },
}

type RouterDecision = {
  source: "jev" | "fallback"
  reason?: string
  stage1?: DecisionResult["stage1"]
  stage2?: DecisionResult["stage2"]
  candidates?: readonly ModelCandidate[]
  resolved: DecisionResult["resolved"]
  usage: DecisionResult["usage"]
  latencyMs: number
}

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function splitModel(model: string): { provider: string; model: string } | null {
  const idx = model.indexOf("/")
  if (idx <= 0 || idx === model.length - 1) return null
  return { provider: model.slice(0, idx), model: model.slice(idx + 1) }
}

function priceLineFor(tier: ModelCostTier): string {
  if (tier === "free") return "free"
  return `$${TIER_PRICE[tier]}/M input`
}

function strengthFor(provider: string, model: string, tier?: ModelCostTier): string {
  const knowledge = readModelKnowledge(provider, model)
  const oneLiner =
    knowledge?.strengths?.[0] ?? knowledge?.bestFor?.[0] ?? knowledge?.description
  if (oneLiner) return oneLiner
  if (tier) return `${tier}-tier model suited to routine delegation`
  return "general-purpose model"
}

function excerpt(prompt: string): string {
  return prompt.length > PROMPT_EXCERPT_CAP ? prompt.slice(0, PROMPT_EXCERPT_CAP) : prompt
}

const TIER_RANK: Record<ModelCostTier, number> = {
  free: 0,
  budget: 1,
  balanced: 2,
  premium: 3,
}

/**
 * When the deterministic fallback fires we still must dispatch to a model that is
 * actually connected. The deep category default (openai/gpt-5.6-sol) can be
 * offline in a minimal provider setup, which previously killed the spawned
 * session with ProviderModelNotFoundError. Resolve an AVAILABLE model instead:
 * first try the deep category's own fallback chain, then fall back to the
 * cheapest available adequate model. Returns undefined only when no model is
 * available at all (in which case the caller keeps the bare { category: "deep" }).
 */
function resolveFallbackModel(availableModels: ReadonlySet<string>): string | undefined {
  if (availableModels.size === 0) return undefined

  const deepRequirement = CATEGORY_MODEL_REQUIREMENTS["deep"]
  const resolved = resolveModelForDelegateTaskCore(
    {
      categoryDefaultModel: "openai/gpt-5.6-sol",
      fallbackChain: deepRequirement?.fallbackChain,
      availableModels,
    },
    {
      connectedProviders: null,
      hasProviderModelsCache: false,
      hasConnectedProvidersCache: false,
    },
  )
  if (resolved && !("skipped" in resolved) && resolved.model) {
    return resolved.model
  }

  return cheapestAvailableModel(availableModels)
}

function cheapestAvailableModel(availableModels: ReadonlySet<string>): string | undefined {
  let best: string | undefined
  let bestRank = Number.POSITIVE_INFINITY
  for (const model of availableModels) {
    const modelId = model.split("/")[1] ?? model
    const tier = getModelProfile(modelId)?.costTier
    const rank = tier ? TIER_RANK[tier] : TIER_RANK.balanced
    if (rank < bestRank) {
      bestRank = rank
      best = model
    }
  }
  return best
}

/**
 * Derive a real outcome status from the sync task completion string. The sync
 * poller surfaces failure/abort/timeout as human-readable strings; we classify
 * them so the ledger backfill is no longer hard-coded to "success".
 *   - timeout: the stall watchdog / poll inactivity timeout fired
 *   - failure: an abort, incomplete deliverable, no-progress, or error string
 *   - success: any normal completion message
 */
export function classifySyncOutcome(result: string): DecisionRouterOutcome["status"] {
  if (/timeout/i.test(result)) return "timeout"
  if (/aborted|incomplete|no new work|no assistant|error/i.test(result)) return "failure"
  return "success"
}

function buildStage1Questions(): Record<string, unknown> {
  return {
    path: buildPathQuestion(PATH_OPTIONS),
    effort: buildEffortQuestion(),
  }
}

function buildStage2Questions(candidates: readonly ModelCandidate[]): Record<string, unknown> {
  return {
    model: buildModelQuestion(candidates),
    lane: buildLaneQuestion(),
  }
}

function fallbackDecision(reason: string): RouterDecision {
  return {
    source: "fallback",
    reason,
    candidates: [],
    resolved: {},
    usage: { inputTokens: 0, costUsd: 0 },
    latencyMs: 0,
  }
}

export function createDecisionRouter(deps: DecisionRouterDeps) {
  const sessionId = deps.sessionId ?? "momo-decision-router"
  const getApiKey = deps.getApiKey ?? (() => getProviderApiKey(DEFAULT_ZEN_PROVIDER) ?? "")
  const ledger = deps.ledger ?? createDecisionLedger()
  const jev = deps.config.jev

  // Candidate snapshot is populated per route() call; buildCandidates (sync, called
  // by the engine) reads it from this closure.
  let candidateModels: Set<string> | undefined
  let candidatePool: ModelPool | undefined

  function defaultBuildCandidates(_ctx: BuildCandidatesContext): readonly ModelCandidate[] {
    if (!candidateModels) return []
    const pool = candidatePool ?? readModelPool()
    const enriched = []
    for (const model of candidateModels) {
      const split = splitModel(model)
      if (!split) continue
      if (!isModelAllowed(pool, split.provider, split.model)) continue
      const profile = getModelProfile(split.model)
      const tier = profile?.costTier
      enriched.push({
        split,
        tier,
        priceValue: tier ? TIER_PRICE[tier] : Number.POSITIVE_INFINITY,
      })
    }
    enriched.sort((a, b) => a.priceValue - b.priceValue)
    return enriched.slice(0, 6).map((e) => ({
      name: `${e.split.provider}/${e.split.model}`,
      priceLine: e.tier ? priceLineFor(e.tier) : "price: unknown",
      strength: strengthFor(e.split.provider, e.split.model, e.tier),
    }))
  }

  const buildCandidates = deps.buildCandidatesImpl ?? defaultBuildCandidates

  const engine =
    deps.engine ??
    createDecisionEngine({
      client: createJevClient({
        session: sessionId,
        getApiKey,
        baseUrl: jev.base_url,
        model: jev.model,
        maxAttempts: jev.max_attempts,
      }),
      buildCandidates,
      pathOptions: PATH_OPTIONS,
      confidenceThreshold: jev.confidence_threshold,
      breakerFailures: jev.circuit_breaker.failures,
      breakerCooldownMs: jev.circuit_breaker.cooldown_ms,
    })

  function toRewrite(
    decision: RouterDecision,
    availableModels: ReadonlySet<string>,
  ): { rewrite: DecisionRouterRewrite; rescued: boolean } {
    if (decision.source === "fallback") {
      const rescue = resolveFallbackModel(availableModels)
      if (rescue) {
        return { rewrite: { category: "deep", model: rescue }, rescued: true }
      }
      return { rewrite: { category: "deep" }, rescued: false }
    }
    const base = PATH_REWRITE[decision.resolved.path ?? ""] ?? { category: "deep" }
    if (decision.resolved.model) return { rewrite: { ...base, model: decision.resolved.model }, rescued: false }
    return { rewrite: { ...base }, rescued: false }
  }

  function toLedgerEntry(task: DecisionTask, decision: RouterDecision): DecisionLedgerRecordInput {
    return {
      session: sessionId,
      task: { description: task.description, promptExcerpt: excerpt(task.prompt) },
      stage1: decision.stage1
        ? {
            questions: buildStage1Questions(),
            answers: decision.stage1,
            confidence: decision.stage1.path?.confidence,
            latencyMs: decision.latencyMs,
          }
        : undefined,
      candidates: decision.candidates?.map((c) => ({
        name: c.name,
        priceLine: c.priceLine,
        strength: c.strength,
      })),
      stage2: decision.stage2
        ? {
            questions: buildStage2Questions(decision.candidates ?? []),
            answers: decision.stage2,
            latencyMs: decision.latencyMs,
          }
        : undefined,
      resolved: decision.resolved,
      source: decision.source,
      reason: decision.reason,
      usage: decision.usage,
    }
  }

  function recordDecision(task: DecisionTask, decision: RouterDecision): string | undefined {
    try {
      const { id } = ledger.record(toLedgerEntry(task, decision))
      return id
    } catch (error) {
      log("[decision-router] ledger.record failed; dispatch continues", { error: errMsg(error) })
      return undefined
    }
  }

  function finalize(
    task: DecisionTask,
    decision: RouterDecision,
    availableModels: ReadonlySet<string>,
  ): DecisionRouterResult {
    const { rewrite, rescued } = toRewrite(decision, availableModels)
    const reason = rescued ? `${decision.reason}+model-rescue` : decision.reason
    const decisionForLedger = rescued ? { ...decision, reason } : decision
    const decisionId = recordDecision(task, decisionForLedger)
    return { source: decision.source, reason, rewrite, decisionId }
  }

  async function route(task: DecisionTask): Promise<DecisionRouterResult> {
    let overBudget = false
    try {
      overBudget = ledger.monthlySpendUsd() >= jev.budget.monthly_cap_usd
    } catch (error) {
      log("[decision-router] budget read failed; proceeding", { error: errMsg(error) })
    }
    if (overBudget) {
      return finalize(task, fallbackDecision("budget-cap"), availableModels())
    }

    if (deps.availableModelsOverride) {
      candidateModels = deps.availableModelsOverride as Set<string>
    } else if (!deps.buildCandidatesImpl) {
      try {
        candidateModels = await getAvailableModelsForDelegateTask(deps.client)
        candidatePool = deps.modelPoolOverride ?? readModelPool()
      } catch (error) {
        log("[decision-router] candidate snapshot failed; routing blind", { error: errMsg(error) })
        candidateModels = new Set()
      }
    }

    const available = candidateModels ?? new Set<string>()

    let result: DecisionResult
    try {
      result = await engine.decide(task)
    } catch (error) {
      log("[decision-router] engine.decide threw; using deterministic default", {
        error: errMsg(error),
      })
      return finalize(task, fallbackDecision("jev-error"), available)
    }

    return finalize(task, result, available)
  }

  function availableModels(): ReadonlySet<string> {
    return candidateModels ?? new Set<string>()
  }

  function backfill(decisionId: string | undefined, outcome: DecisionRouterOutcome): void {
    if (!decisionId) return
    try {
      ledger.backfillOutcome({ decisionId, ...outcome })
    } catch (error) {
      log("[decision-router] ledger.backfill failed; ignored", { error: errMsg(error) })
    }
  }

  return { route, backfill }
}
