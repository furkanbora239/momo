// agent-config-converter.ts — pure converters between momo's V1 agent config
// entries and the V2 agent domain shapes.
//
// V1 source of truth: SDK `AgentConfig` (see agent-config-handler.ts). V2
// target of truth: `Agent.Info` from @opencode/schema (grounded from dist
// agent.d.ts) with the renames `prompt -> system`, `maxSteps -> steps`,
// `permission map -> permissions ruleset` and `disable -> disabled` (the V2
// config-schema agent entry surfaces `disabled`; the runtime `Agent.Info`
// surfaces it through the same registry, so the bridge carries it explicitly).
//
// Everything here is pure and synchronous: the config-bridge calls these
// inside replayable `transform` callbacks, which must stay cheap.

import type { Agent } from "@opencode/plugin"
import type { DeepMutable } from "@opencode/plugin/promise/types"
import type { AgentConfig } from "@opencode-ai/sdk"
import type { V2PluginContext } from "./types"

export type V1AgentEntry = AgentConfig
export type V1AgentPermissionMap = NonNullable<AgentConfig["permission"]>
export type V1PermissionEffect = "ask" | "allow" | "deny"

export interface V2PermissionRule {
  readonly action: string
  readonly resource: string
  readonly effect: V1PermissionEffect
}

export interface V2AgentModelRef {
  readonly id: string
  readonly providerID: string
  readonly variant?: string
}

export interface V2AgentMutation {
  readonly id: string
  readonly name: string
  readonly system?: string
  readonly model?: V2AgentModelRef
  readonly description?: string
  readonly mode?: "subagent" | "primary" | "all"
  readonly color?: string
  readonly steps?: number
  readonly permissions?: readonly V2PermissionRule[]
  readonly temperature?: number
  readonly topP?: number
  readonly disabled?: boolean
}

/** V1 permission action -> V2 action (bash becomes shell; task becomes subagent). */
const V1_TO_V2_ACTION: Record<string, string> = {
  bash: "shell",
  task: "subagent",
  write: "edit",
  patch: "edit",
}

/** V2 action -> V1 permission key (inverse of V1_TO_V2_ACTION). */
const V2_TO_V1_ACTION: Record<string, string> = {
  shell: "bash",
  subagent: "task",
  edit: "edit",
}

function toV2Action(action: string): string {
  return V1_TO_V2_ACTION[action] ?? action
}

function toV1Action(action: string): string {
  return V2_TO_V1_ACTION[action] ?? action
}

function readEffect(value: unknown): V1PermissionEffect | undefined {
  return value === "ask" || value === "allow" || value === "deny" ? value : undefined
}

/** V1 permission map -> V2 ruleset. `bash` may carry a per-command submap. */
export function convertV1PermissionToRules(
  permission: V1AgentPermissionMap,
): V2PermissionRule[] {
  const rules: V2PermissionRule[] = []
  for (const [action, value] of Object.entries(permission)) {
    const v2Action = toV2Action(action)
    if (typeof value === "string") {
      const effect = readEffect(value)
      if (effect) rules.push({ action: v2Action, resource: "*", effect })
      continue
    }
    if (typeof value === "object" && value !== null) {
      for (const [pattern, effectValue] of Object.entries(value)) {
        const effect = readEffect(effectValue)
        if (effect) rules.push({ action: v2Action, resource: pattern, effect })
      }
    }
  }
  return rules
}

/** V2 ruleset -> V1 permission map (best-effort inverse). */
export function convertV2PermissionRulesToV1Map(
  rules: readonly V2PermissionRule[],
): V1AgentPermissionMap {
  const map: Record<string, unknown> = {}
  for (const rule of rules) {
    const action = toV1Action(rule.action)
    const current = map[action]
    if (rule.resource !== "*" && action === "bash") {
      const submap = (typeof current === "object" && current !== null ? current : {}) as Record<string, V1PermissionEffect>
      submap[rule.resource] = rule.effect
      map[action] = submap
      continue
    }
    map[action] = rule.effect
  }
  return map as V1AgentPermissionMap
}

/** `provider/model#variant` -> V2 model ref. Returns undefined when unparseable. */
export function parseV1ModelRef(model: string): V2AgentModelRef | undefined {
  const slashIndex = model.indexOf("/")
  if (slashIndex <= 0 || slashIndex === model.length - 1) return undefined
  const providerID = model.slice(0, slashIndex)
  let modelID = model.slice(slashIndex + 1)
  let variant: string | undefined
  const hashIndex = modelID.indexOf("#")
  if (hashIndex >= 0) {
    variant = modelID.slice(hashIndex + 1)
    modelID = modelID.slice(0, hashIndex)
    if (variant.length === 0) variant = undefined
  }
  if (modelID.length === 0) return undefined
  return { id: modelID, providerID, ...(variant !== undefined ? { variant } : {}) }
}

/** V1 agent entry -> V2 mutation payload consumed by the agent transform. */export function convertV1AgentEntry(id: string, entry: V1AgentEntry): V2AgentMutation {
  const model = typeof entry.model === "string" ? parseV1ModelRef(entry.model) : undefined
  const bodyTemperature = typeof entry.temperature === "number" ? entry.temperature : undefined
  const bodyTopP = typeof entry.top_p === "number" ? entry.top_p : undefined
  return {
    id,
    name: id,
    ...(entry.prompt !== undefined ? { system: entry.prompt } : {}),
    ...(model !== undefined ? { model } : {}),
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    ...(entry.mode !== undefined ? { mode: entry.mode } : {}),
    ...(entry.color !== undefined ? { color: entry.color } : {}),
    ...(entry.maxSteps !== undefined ? { steps: entry.maxSteps } : {}),
    ...(entry.permission !== undefined ? { permissions: convertV1PermissionToRules(entry.permission) } : {}),
    ...(bodyTemperature !== undefined ? { temperature: bodyTemperature } : {}),
    ...(bodyTopP !== undefined ? { topP: bodyTopP } : {}),
    ...(entry.disable !== undefined ? { disabled: entry.disable } : {}),
  }
}

/** Client-side list record for one agent (plain strings, from the plugin ctx). */
export type V2AgentListRecord = Awaited<ReturnType<V2PluginContext["agent"]["list"]>>["data"][number]

/** V2 agent info -> V1-shaped seed entry (best-effort; unmappable fields stay undefined). */
export function convertV2AgentInfoToV1Entry(info: V2AgentListRecord): V1AgentEntry {
  const model = info.model
  const modelString =
    model !== undefined && typeof model.providerID === "string" && typeof model.id === "string"
      ? `${model.providerID}/${model.id}${typeof model.variant === "string" ? `#${model.variant}` : ""}`
      : undefined
  const body = info.request?.body
  const temperature = body && typeof body.temperature === "number" ? body.temperature : undefined
  const topP = body && typeof body.top_p === "number" ? body.top_p : undefined
  const permissions = Array.isArray(info.permissions) ? info.permissions : []
  return {
    ...(modelString !== undefined ? { model: modelString } : {}),
    ...(typeof info.system === "string" ? { prompt: info.system } : {}),
    ...(typeof info.description === "string" ? { description: info.description } : {}),
    ...(info.mode !== undefined ? { mode: info.mode } : {}),
    ...(typeof info.color === "string" ? { color: info.color } : {}),
    ...(typeof info.steps === "number" ? { maxSteps: info.steps } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(topP !== undefined ? { top_p: topP } : {}),
    ...(permissions.length > 0 ? { permission: convertV2PermissionRulesToV1Map(permissions) } : {}),
  }
}

/**
 * Apply a converted mutation onto the mutable agent handed out by the V2
 * agent transform callback. Only present fields are written; temperature and
 * top_p land under `request.body` and `disabled` rides as a registry field
 * (the V2 config schema's agent entry defines it).
 */
export function applyV2AgentMutation(
  agent: DeepMutable<Agent.Info>,
  mutation: V2AgentMutation,
): void {
  if (mutation.system !== undefined) agent.system = mutation.system
  if (mutation.model !== undefined) agent.model = mutation.model as Agent.Info["model"]
  if (mutation.description !== undefined) agent.description = mutation.description
  if (mutation.mode !== undefined) agent.mode = mutation.mode
  if (mutation.color !== undefined) agent.color = mutation.color
  if (mutation.steps !== undefined) agent.steps = mutation.steps
  if (mutation.permissions !== undefined) {
    agent.permissions = mutation.permissions.map((rule) => ({ ...rule }))
  }
  const body = agent.request?.body
  if (mutation.temperature !== undefined && body) body.temperature = mutation.temperature
  if (mutation.topP !== undefined && body) body.top_p = mutation.topP
  if (mutation.disabled !== undefined) {
    ;(agent as DeepMutable<Agent.Info> & { disabled?: boolean }).disabled = mutation.disabled
  }
}
