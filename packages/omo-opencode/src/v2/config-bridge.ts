// config-bridge.ts — run momo's V1 config handler and distribute its
// mutations onto the V2 domains.
//
// Flow (per the V1 contract, the handler MUTATES the config in place):
//   1. seed a V1-shaped `Config` best-effort from the V2 domains (config-seed)
//   2. snapshot the seed, then `await configHandler(seed)`
//   3. diff seed vs post-handler for agent/command/mcp/provider/model maps
//   4. apply the diff through one synchronous, replayable transform per domain
//
// Each domain apply is individually guarded: a failing transform logs and
// lets the remaining domains still register.

import type { Config } from "@opencode-ai/plugin"
import type { Agent, Mcp, Provider } from "@opencode/plugin"
import type { V2AgentMutation, V1AgentEntry } from "./agent-config-converter"
import { applyV2AgentMutation, convertV1AgentEntry, parseV1ModelRef } from "./agent-config-converter"
import { emitNewAgentFiles } from "./agent-file-emitter"
import { convertV1CommandDefinition, type V2PromptSender } from "./command-config-converter"
import { convertV1McpEntry, mcpSeedEntryChanged } from "./mcp-config-converter"
import {
  appendV1ProviderModels,
  convertV1ModelConfigToV2,
  convertV1ProviderConfigToV2,
} from "./provider-config-converter"
import { diffRecordKeys } from "./config-diff"
import { buildV1ConfigSeed } from "./config-seed"
import { log } from "../shared/logger"
import type { V2PluginContext } from "./types"

export type V1ConfigHandler = (input: Config) => Promise<void>

async function safeApply(label: string, apply: () => Promise<void>): Promise<void> {
  try {
    await apply()
  } catch (error) {
    log(`[v2-config-bridge] ${label} transform failed; skipped`, {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function applyAgentDiff(ctx: V2PluginContext, before: Config, after: Config): Promise<void> {
  const beforeAgent: Record<string, V1AgentEntry | undefined> = before.agent ?? {}
  const afterAgent: Record<string, V1AgentEntry | undefined> = after.agent ?? {}
  const diff = diffRecordKeys(beforeAgent, afterAgent)
  const beforeDefault = (before as Record<string, unknown>).default_agent
  const afterDefault = (after as Record<string, unknown>).default_agent
  const defaultChanged = typeof afterDefault === "string" && afterDefault !== beforeDefault
  if (diff.added.length === 0 && diff.changed.length === 0 && diff.removed.length === 0) {
    if (!defaultChanged) return
  }

  // AgentEditor cannot add (promise/agent.d.ts): NEW agents (absent from the
  // seed built from ctx.agent.list()) register as file-based agent
  // definitions, followed by one reload so the registry picks them up.
  if (diff.added.length > 0) {
    const newEntries = diff.added.flatMap((id) => {
      const entry = afterAgent[id]
      return entry === undefined ? [] : [{ id, entry }]
    })
    const result = await emitNewAgentFiles(newEntries, { fallbackRoot: ctx.location.directory })
    if (result.emitted.length > 0) {
      log("[v2-config-bridge] emitted file-based agents", {
        directory: result.directory,
        agentIds: result.emitted,
      })
      await ctx.agent.reload()
    }
  }

  if (diff.changed.length === 0 && diff.removed.length === 0 && !defaultChanged) return

  await ctx.agent.transform((editor) => {
    for (const id of diff.removed) {
      editor.remove(id)
    }
    for (const id of diff.changed) {
      const entry = afterAgent[id]
      if (entry === undefined) continue
      const mutation: V2AgentMutation = convertV1AgentEntry(id, entry)
      editor.update(id, (agent) => {
        applyV2AgentMutation(agent, mutation)
      })
    }
    if (defaultChanged) {
      editor.default(afterDefault)
    }
  })
}

/**
 * The V2 command editor can only add; the V1 seed carries no template, so
 * commands are diffed by key presence: only names absent from the seed are
 * pushed, avoiding duplicate registrations for unchanged commands.
 */
async function applyCommandDiff(ctx: V2PluginContext, before: Config, after: Config): Promise<void> {
  const afterCommand = after.command
  if (!afterCommand) return
  const beforeCommand = before.command ?? {}
  const added = Object.keys(afterCommand).filter((name) => !(name in beforeCommand))
  if (added.length === 0) return
  const prompt: V2PromptSender = (input) => ctx.session.prompt(input)

  await ctx.command.transform((editor) => {
    for (const name of added) {
      const entry = afterCommand[name]
      if (entry === undefined) continue
      editor.add(convertV1CommandDefinition(name, entry, prompt))
    }
  })
}

async function applyMcpDiff(ctx: V2PluginContext, before: Config, after: Config): Promise<void> {
  const afterMcp = after.mcp
  if (!afterMcp) return
  const beforeMcp = before.mcp ?? {}
  const added = Object.keys(afterMcp).filter((name) => !(name in beforeMcp))
  const removed = Object.keys(beforeMcp).filter((name) => !(name in afterMcp))
  const toggled = Object.keys(beforeMcp).filter(
    (name) => name in afterMcp && afterMcp[name] !== undefined && beforeMcp[name] !== undefined &&
      mcpSeedEntryChanged(beforeMcp[name], afterMcp[name]),
  )
  if (added.length === 0 && removed.length === 0 && toggled.length === 0) return

  await ctx.mcp.transform((editor) => {
    for (const name of removed) {
      editor.remove(name)
    }
    for (const name of added) {
      const entry = afterMcp[name]
      if (entry === undefined) continue
      editor.set(name, convertV1McpEntry(entry))
    }
    for (const name of toggled) {
      const entry = afterMcp[name]
      if (entry === undefined) continue
      const disabled = entry.enabled === false
      editor.update(name, (config) => {
        config.disabled = disabled
      })
    }
  })
}

async function applyProviderDiff(ctx: V2PluginContext, before: Config, after: Config): Promise<void> {
  const afterProvider = after.provider
  if (!afterProvider) return
  const beforeProvider = before.provider ?? {}
  const diff = diffRecordKeys(beforeProvider, afterProvider)
  const changed = [...diff.added, ...diff.changed]
  if (changed.length === 0 && diff.removed.length === 0) return

  await ctx.provider.transform((editor) => {
    for (const providerID of diff.removed) {
      editor.remove(providerID)
    }
    for (const providerID of changed) {
      const config = afterProvider[providerID]
      const record = editor.get(providerID)
      if (record === undefined) {
        if (diff.added.includes(providerID)) {
          const models = Object.entries(config.models ?? {}).map(([modelID, entry]) =>
            convertV1ModelConfigToV2(providerID, modelID, entry),
          )
          editor.add({ info: convertV1ProviderConfigToV2(providerID, config), models })
        }
        continue
      }
      editor.update(providerID, (provider) => {
        if (config.name !== undefined) provider.name = config.name
        if (config.options !== undefined) {
          provider.settings = structuredClone(config.options) as Provider.Info["settings"]
        }
      })
      const existing = [...record.models.values()]
      const merged = appendV1ProviderModels(providerID, existing, config.models ?? {})
      if (merged.length > existing.length) {
        editor.models.set(providerID, merged)
      }
    }
  })
}

async function applyModelDiff(ctx: V2PluginContext, before: Config, after: Config): Promise<void> {
  const afterModel = typeof after.model === "string" ? after.model : undefined
  const beforeModel = typeof before.model === "string" ? before.model : undefined
  if (afterModel === undefined || afterModel === beforeModel) return
  const parsed = parseV1ModelRef(afterModel)
  if (parsed === undefined) {
    log("[v2-config-bridge] default model is not provider/model; dropped", { model: afterModel })
    return
  }

  await ctx.model.transform((editor) => {
    editor.default.set(parsed.providerID, parsed.id)
  })
}

export async function registerV2ConfigDomains(
  ctx: V2PluginContext,
  configHandler: V1ConfigHandler | undefined,
): Promise<void> {
  if (configHandler === undefined) return

  const seed = await buildV1ConfigSeed(ctx)
  const snapshot = structuredClone(seed)
  await configHandler(seed)

  await safeApply("agent", () => applyAgentDiff(ctx, snapshot, seed))
  await safeApply("command", () => applyCommandDiff(ctx, snapshot, seed))
  await safeApply("mcp", () => applyMcpDiff(ctx, snapshot, seed))
  await safeApply("provider", () => applyProviderDiff(ctx, snapshot, seed))
  await safeApply("model", () => applyModelDiff(ctx, snapshot, seed))
}
