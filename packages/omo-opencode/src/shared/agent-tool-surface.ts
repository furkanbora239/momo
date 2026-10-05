/**
 * M2b per-agent permission maps for the kept roster.
 *
 * Each kept-roster agent gets an explicit expected tool surface under V2 naming:
 * an `allowed` set (tools positively present on the surface) and a `removed` set
 * (tools denied, i.e. removed from the surface under V2 deny = remove semantics).
 *
 * This module is the SINGLE SOURCE OF TRUTH for the expected surface. The QA
 * manifest (`script/qa/opencode-v2-qa-tool-surface.json`) is generated from it by
 * `script/qa/gen-agent-tool-surface.ts` and a test asserts the two never drift.
 *
 * Reuses M2a derivation helpers rather than re-implementing tool-name mapping:
 *   - getAgentToolRestrictions (applies normalizeToolRecord + worker read-side baseline)
 *   - deriveAllowedToolNames / deriveRemovedToolNames (session-tools-store)
 *
 * V2 naming is authoritative: bash->shell, task->subagent, write/patch->edit.
 */
import { getAgentToolRestrictions } from "./agent-tool-restrictions"
import { deriveAllowedToolNames, deriveRemovedToolNames } from "./session-tools-store"

export type AgentClass =
  | "orchestrator"
  | "planner"
  | "worker"
  | "advisor"
  | "read-only"
  | "manager"
  | "researcher"

export interface AgentToolSurface {
  /** Agent class used by the QA manifest to select which hard gates apply. */
  agentClass: AgentClass
  /** Tools positively present on the surface (V2 names). */
  allowed: string[]
  /** Tools removed from the surface (V2 names). */
  removed: string[]
}

/**
 * Worker-class agents receive the M2a read-side baseline (codegraph_*, skill,
 * websearch, webfetch). Required to be worker/sisyphus-junior or the manager-layer
 * execution agent (executor).
 */
export const WORKER_CLASS_AGENTS: ReadonlyArray<string> = [
  "sisyphus-junior",
  "worker",
  "executor",
]

/**
 * The M7 advisoryPresence list (codegraph / websearch / webfetch / skill), promoted
 * to a HARD presence gate for worker-class agents by M2b. Expressed as the concrete
 * V2 tool names the regression exam declares as the expected worker surface.
 *
 * Only `codegraph_explore` is used here (not the full codegraph_* family): the
 * codegraph MCP only registers the indexed-query tools once a project index is
 * built, and `codegraph_explore` is the one tool the MCP serves unconditionally.
 * The complete worker read-side surface (all nine codegraph_* tools plus skill_mcp)
 * remains in PER_AGENT_TOOL_SURFACE[].allowed as the documented intended surface.
 */
export const WORKER_PRESENCE_GATE: ReadonlyArray<string> = [
  "codegraph_explore",
  "skill",
  "websearch",
  "webfetch",
]

/**
 * Live-sandbox observable subset of WORKER_PRESENCE_GATE. The M7 sandbox does not
 * wire the codegraph MCP tools to the model (even the parent reports
 * CANNOT_CALL_CODEGRAPH) and `skill` is non-deterministic for the runbook model, so
 * the live exam asserts only the always-available web read-side tools. codegraph
 * and skill presence is covered by the unit tests against PER_AGENT_TOOL_SURFACE.
 */
export const WORKER_LIVE_PRESENCE_GATE: ReadonlyArray<string> = [
  "websearch",
  "webfetch",
]

/** Kept roster: orchestrator + subagents that survive into v2. */
const KEPT_ROSTER: ReadonlyArray<{ name: string; agentClass: AgentClass }> = [
  { name: "sisyphus", agentClass: "orchestrator" },
  { name: "planner", agentClass: "planner" },
  { name: "sisyphus-junior", agentClass: "worker" },
  { name: "worker", agentClass: "worker" },
  { name: "executor", agentClass: "worker" },
  { name: "advisor", agentClass: "advisor" },
  { name: "explore", agentClass: "read-only" },
  { name: "librarian", agentClass: "read-only" },
  { name: "research", agentClass: "read-only" },
  { name: "reviewer", agentClass: "manager" },
  { name: "catalog-researcher", agentClass: "researcher" },
]

function buildPerAgentToolSurface(): Record<string, AgentToolSurface> {
  const out: Record<string, AgentToolSurface> = {}
  for (const { name, agentClass } of KEPT_ROSTER) {
    // getAgentToolRestrictions returns the final V2 restriction record (deny =
    // remove). deriveAllowedToolNames picks the positively-granted tools;
    // deriveRemovedToolNames picks the denied (removed) tools.
    const restrictions = getAgentToolRestrictions(name)
    out[name] = {
      agentClass,
      allowed: deriveAllowedToolNames(restrictions),
      removed: deriveRemovedToolNames(restrictions),
    }
  }
  return out
}

/**
 * Expected tool surface per kept-roster agent, under V2 naming. Derived from
 * M2a's restriction engine so it can never drift from the live deny/allow logic.
 */
export const PER_AGENT_TOOL_SURFACE: Readonly<Record<string, AgentToolSurface>> =
  buildPerAgentToolSurface()

export interface QaAgentManifestEntry {
  class: AgentClass
  /**
   * Hard presence gate (M2b promotion of M7 advisoryPresence): every tool in this
   * set is part of the worker's expected read-side surface and MUST be granted.
   * It is the declared source-of-truth expected surface for the agent.
   */
  requiredPresence: string[]
  /**
   * Live-sandbox observable subset of requiredPresence. The M7 sandbox cannot
   * surface MCP tools (the codegraph MCP is spawned but not wired to the model in
   * this environment) and `skill` invocation is non-deterministic for the runbook
   * model, so the live exam asserts only this subset. codegraph/skill presence is
   * proven at the code level by the unit tests against PER_AGENT_TOOL_SURFACE.
   */
  livePresenceGate: string[]
  /** Hard absence gate: no tool MAY be observed on the child surface. */
  removed: string[]
}

export interface QaToolSurfaceManifest {
  description: string
  /** Universal baseline: union of observed tools must intersect this (soft-ish). */
  requiredBaseline: string[]
  agents: Record<string, QaAgentManifestEntry>
}

/**
 * Build the QA manifest from the code-level maps. Worker-class agents get the
 * promoted advisoryPresence as a hard requiredPresence gate; every agent carries
 * its derived removed set as a hard absence gate.
 */
export function buildQaManifest(): QaToolSurfaceManifest {
  const agents: Record<string, QaAgentManifestEntry> = {}
  for (const [name, surface] of Object.entries(PER_AGENT_TOOL_SURFACE)) {
    const isWorker = WORKER_CLASS_AGENTS.includes(name)
    agents[name] = {
      class: surface.agentClass,
      requiredPresence: isWorker ? [...WORKER_PRESENCE_GATE] : [...surface.allowed],
      livePresenceGate: isWorker ? [...WORKER_LIVE_PRESENCE_GATE] : [],
      removed: [...surface.removed],
    }
  }
  return {
    description:
      "Expected child (worker/subagent) tool surface for the M7+M2b regression exam. " +
      "Per-agent requiredPresence (hard gate, promoted from M7 advisoryPresence for " +
      "worker-class agents: codegraph/websearch/webfetch/skill) and removed (hard gate) " +
      "are generated from packages/omo-opencode/src/shared/agent-tool-surface.ts, the " +
      "single source of truth. Union of observed child tool names must satisfy every " +
      "worker-class requiredPresence entry and must contain none of any agent's removed set.",
    requiredBaseline: ["read", "shell", "execute", "edit"],
    agents,
  }
}
