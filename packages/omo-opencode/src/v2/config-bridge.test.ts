import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import type { Config } from "@opencode-ai/plugin"
import type { Agent, Mcp, Provider } from "@opencode/plugin"
import type { CommandInvocation } from "@opencode/plugin/promise/command"
import type { DeepMutable } from "@opencode/plugin/promise/types"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { V2PluginContext } from "./types"
import { registerV2ConfigDomains } from "./config-bridge"

type AgentUpdate = { id: string; agent: DeepMutable<Agent.Info> }
type McpSet = { name: string; config: Mcp.ServerConfig }
type McpUpdate = { name: string; config: DeepMutable<Mcp.ServerConfig> }
type ProviderUpdate = { id: string; provider: DeepMutable<Provider.Info> }

const ORIGINAL_OPENCODE_CONFIG_DIR = process.env.OPENCODE_CONFIG_DIR
let tempConfigRoot: string

beforeEach(() => {
  tempConfigRoot = mkdtempSync(join(tmpdir(), "omo-config-bridge-"))
  mkdirSync(tempConfigRoot, { recursive: true })
  process.env.OPENCODE_CONFIG_DIR = tempConfigRoot
})

afterEach(() => {
  if (ORIGINAL_OPENCODE_CONFIG_DIR === undefined) {
    delete process.env.OPENCODE_CONFIG_DIR
  } else {
    process.env.OPENCODE_CONFIG_DIR = ORIGINAL_OPENCODE_CONFIG_DIR
  }
  rmSync(tempConfigRoot, { recursive: true, force: true })
})

function createFakeAgentInfo(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "stale-agent",
    name: "stale-agent",
    mode: "subagent",
    hidden: false,
    permissions: [],
    request: { settings: {}, headers: {}, body: {} },
    ...overrides,
  }
}

function createFakeModelInfo(modelID: string, providerID: string): Record<string, unknown> {
  return {
    id: modelID,
    modelID,
    providerID,
    name: modelID === "mod-1" ? "Model One" : modelID,
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    variants: [],
    time: { released: 0 },
    cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    status: "active",
    enabled: true,
    limit: { context: 100, output: 50 },
  }
}

function createFakeCtx() {
  const agentUpdates: AgentUpdate[] = []
  const agentRemovals: string[] = []
  const agentDefaults: Array<string | undefined> = []
  const commandAdds: Array<{ name: string; description?: string; execute: (input: CommandInvocation) => Promise<void> }> = []
  const mcpSets: McpSet[] = []
  const mcpUpdates: McpUpdate[] = []
  const mcpRemovals: string[] = []
  const providerAdds: Array<{ info: Provider.Info; models: unknown[] }> = []
  const providerUpdates: ProviderUpdate[] = []
  const providerRemovals: string[] = []
  const providerModelSets: Array<{ providerID: string; models: unknown[] }> = []
  const modelDefaults: Array<{ providerID: string; modelID: string }> = []
  const prompts: unknown[] = []
  let transformCalls = 0
  let agentListCalls = 0
  let agentReloadCalls = 0

  const modelOne = createFakeModelInfo("mod-1", "prov-1")
  const ctx = {
    location: { directory: tempConfigRoot, project: { id: "fixture-project" } },
    agent: {
      list: async () => {
        agentListCalls += 1
        return {
          location: { directory: "/fixture" },
          data: [
            createFakeAgentInfo(),
            createFakeAgentInfo({
              id: "existing-agent",
              name: "existing-agent",
              system: "old fixture system",
              description: "old fixture description",
            }),
          ],
        }
      },
      reload: async () => {
        agentReloadCalls += 1
      },
      transform: async (callback: (editor: unknown) => void) => {
        transformCalls += 1
        callback({
          update: (id: string, fn: (agent: DeepMutable<Agent.Info>) => void) => {
            const agent = { ...createFakeAgentInfo(), id } as unknown as DeepMutable<Agent.Info>
            fn(agent)
            agentUpdates.push({ id, agent })
          },
          remove: (id: string) => {
            agentRemovals.push(id)
          },
          default: (id: string | undefined) => {
            agentDefaults.push(id)
          },
        })
        return { dispose: async () => {} }
      },
    },
    command: {
      list: async () => ({
        location: { directory: "/fixture" },
        data: [{ name: "existing-command", description: "existing description" }],
      }),
      transform: async (callback: (editor: unknown) => void) => {
        transformCalls += 1
        callback({
          add: (definition: (typeof commandAdds)[number]) => {
            commandAdds.push(definition)
          },
        })
        return { dispose: async () => {} }
      },
    },
    mcp: {
      list: async () => ({
        location: { directory: "/fixture" },
        data: [{ name: "existing-mcp", status: { status: "connected" } }],
      }),
      transform: async (callback: (editor: unknown) => void) => {
        transformCalls += 1
        callback({
          set: (name: string, config: Mcp.ServerConfig) => {
            mcpSets.push({ name, config })
          },
          update: (name: string, fn: (config: DeepMutable<Mcp.ServerConfig>) => void) => {
            const config = { type: "remote", url: "https://existing.example/mcp", disabled: false } as unknown as DeepMutable<Mcp.ServerConfig>
            fn(config)
            mcpUpdates.push({ name, config })
          },
          remove: (name: string) => {
            mcpRemovals.push(name)
          },
        })
        return { dispose: async () => {} }
      },
    },
    provider: {
      list: async () => ({
        location: { directory: "/fixture" },
        data: [
          {
            id: "prov-1",
            name: "Provider One",
            activation: "auto",
            package: "@ai-sdk/fixture",
            models: new Map([[ "mod-1", structuredClone(modelOne) ]]),
          },
        ],
      }),
      transform: async (callback: (editor: unknown) => void) => {
        transformCalls += 1
        callback({
          get: (providerID: string) =>
            providerID === "prov-1"
              ? {
                  provider: { id: providerID, name: "Provider One", activation: "auto", package: "@ai-sdk/fixture" },
                  models: new Map([[ "mod-1", structuredClone(modelOne) ]]),
                }
              : undefined,
          add: (input: { info: Provider.Info; models: unknown[] }) => {
            providerAdds.push(input)
          },
          update: (providerID: string, fn: (provider: DeepMutable<Provider.Info>) => void) => {
            const provider = { id: providerID, name: "", activation: "auto", package: "" } as unknown as DeepMutable<Provider.Info>
            fn(provider)
            providerUpdates.push({ id: providerID, provider })
          },
          remove: (providerID: string) => {
            providerRemovals.push(providerID)
          },
          models: {
            set: (providerID: string, models: unknown[]) => {
              providerModelSets.push({ providerID, models })
            },
            update: () => {},
            remove: () => {},
          },
        })
        return { dispose: async () => {} }
      },
    },
    model: {
      list: async () => ({
        location: { directory: "/fixture" },
        data: [structuredClone(modelOne)],
      }),
      default: async () => ({ location: { directory: "/fixture" }, data: structuredClone(modelOne) }),
      transform: async (callback: (editor: unknown) => void) => {
        transformCalls += 1
        callback({
          default: {
            set: (providerID: string, modelID: string) => {
              modelDefaults.push({ providerID, modelID })
            },
          },
        })
        return { dispose: async () => {} }
      },
    },
    session: {
      prompt: async (input: unknown) => {
        prompts.push(input)
        return undefined
      },
    },
  } as unknown as V2PluginContext

  return {
    ctx,
    agentUpdates,
    agentRemovals,
    agentDefaults,
    commandAdds,
    mcpSets,
    mcpUpdates,
    mcpRemovals,
    providerAdds,
    providerUpdates,
    providerRemovals,
    providerModelSets,
    modelDefaults,
    prompts,
    getTransformCalls: () => transformCalls,
    getAgentListCalls: () => agentListCalls,
    getAgentReloadCalls: () => agentReloadCalls,
  }
}

function createFixtureHandler(): (input: Config) => Promise<void> {
  return async (config) => {
    // Full replacement: momo's handler rebuilds the agent roster. The stale
    // seed entry is dropped; the existing seed agent is updated; two brand
    // new agents register as file-based definitions.
    config.agent = {
      "existing-agent": {
        prompt: "updated fixture system for existing",
        maxSteps: 5,
        mode: "subagent",
      },
      "new-fixture-agent": {
        prompt: "fixture prompt for bridge test",
        disable: true,
        maxSteps: 12,
        temperature: 0.2,
        top_p: 0.9,
        description: "fixture agent description",
        mode: "subagent",
        model: "prov-1/mod-1#fast",
        permission: { edit: "allow", bash: { "rm *": "deny" } },
      },
      "second-fixture-agent": {
        prompt: "second fixture prompt",
        mode: "all",
      },
    }
    config.command = {
      ...config.command,
      "fixture-command": {
        template: "fixture template $ARGUMENTS",
        description: "fixture command description",
      },
    }
    config.mcp = {
      ...config.mcp,
      "fixture-mcp": {
        type: "remote",
        url: "https://fixture.example/mcp",
        enabled: false,
        headers: { "X-Fixture": "1" },
      },
      "existing-mcp": {
        type: "remote",
        url: "https://existing.example/mcp",
        enabled: false,
      },
    }
    const existingProvider = config.provider?.["prov-1"]
    config.provider = {
      ...config.provider,
      "prov-1": {
        ...existingProvider,
        models: {
          ...existingProvider?.models,
          "mod-2": { name: "Injected Model", limit: { context: 50, output: 20 } },
        },
      },
      "fixture-provider": {
        npm: "@ai-sdk/fixture",
        name: "Fixture Provider",
        options: { baseURL: "https://fixture.example/v1" },
        models: {
          "fixture-model": { name: "Fixture Model", limit: { context: 100, output: 40 }, tool_call: true },
        },
      },
    }
    config.model = "prov-1/mod-2"
    ;(config as Record<string, unknown>).default_agent = "fixture-default"
  }
}

describe("#given an undefined config handler", () => {
  it("#when registerV2ConfigDomains is called then no domain is touched", async () => {
    const state = createFakeCtx()
    await registerV2ConfigDomains(state.ctx, undefined)
    expect(state.getTransformCalls()).toBe(0)
    expect(state.getAgentListCalls()).toBe(0)
  })
})

describe("#given a fake V1 handler that mutates the seeded config", () => {
  it("#when registerV2ConfigDomains is called then changed seed agents update and dropped ones remove", async () => {
    const state = createFakeCtx()
    await registerV2ConfigDomains(state.ctx, createFixtureHandler())

    expect(state.agentUpdates).toHaveLength(1)
    const { id, agent } = state.agentUpdates[0]
    expect(id).toBe("existing-agent")
    expect(agent.system).toBe("updated fixture system for existing")
    expect(agent.steps).toBe(5)
    expect(agent.mode).toBe("subagent")
    expect(state.agentRemovals).toEqual(["stale-agent"])
    expect(state.agentDefaults).toEqual(["fixture-default"])
  })

  it("#when registerV2ConfigDomains is called then new agents emit agent .md files and reload once", async () => {
    const state = createFakeCtx()
    await registerV2ConfigDomains(state.ctx, createFixtureHandler())

    const agentsDir = join(tempConfigRoot, "agents")
    const newAgentFile = readFileSync(join(agentsDir, "new-fixture-agent.md"), "utf-8")
    expect(newAgentFile).toContain("description: \"fixture agent description\"")
    expect(newAgentFile).toContain("mode: subagent")
    expect(newAgentFile).toContain("model: \"prov-1/mod-1#fast\"")
    expect(newAgentFile).toContain("steps: 12")
    expect(newAgentFile).toContain("disabled: true")
    expect(newAgentFile).toContain("fixture prompt for bridge test")
    const secondAgentFile = readFileSync(join(agentsDir, "second-fixture-agent.md"), "utf-8")
    expect(secondAgentFile).toBe("---\nmode: all\n---\n\nsecond fixture prompt\n")
    expect(existsSync(join(agentsDir, "existing-agent.md"))).toBe(false)
    expect(existsSync(join(agentsDir, "stale-agent.md"))).toBe(false)
    expect(state.getAgentReloadCalls()).toBe(1)
  })

  it("#when a second run hits the same agents dir then files are not overwritten and reload is not repeated", async () => {
    const state = createFakeCtx()
    await registerV2ConfigDomains(state.ctx, createFixtureHandler())
    const agentsDir = join(tempConfigRoot, "agents")
    const before = readFileSync(join(agentsDir, "new-fixture-agent.md"), "utf-8")

    await registerV2ConfigDomains(state.ctx, createFixtureHandler())

    expect(readFileSync(join(agentsDir, "new-fixture-agent.md"), "utf-8")).toBe(before)
    expect(state.getAgentReloadCalls()).toBe(1)
  })

  it("#when registerV2ConfigDomains is called then new commands are added with execute wired to session.prompt", async () => {
    const state = createFakeCtx()
    await registerV2ConfigDomains(state.ctx, createFixtureHandler())

    expect(state.commandAdds).toHaveLength(1)
    const added = state.commandAdds[0]
    expect(added.name).toBe("fixture-command")
    expect(added.description).toBe("fixture command description")
    await added.execute({
      sessionID: "sess-1" as never,
      prompt: { text: "fixture run text" } as never,
      delivery: "queue" as never,
    })
    expect(state.prompts).toEqual([{ sessionID: "sess-1", text: "fixture run text" }])
  })

  it("#when registerV2ConfigDomains is called then mcp diffs land with disabled as the enabled inverse", async () => {
    const state = createFakeCtx()
    await registerV2ConfigDomains(state.ctx, createFixtureHandler())

    expect(state.mcpSets).toEqual([
      {
        name: "fixture-mcp",
        config: {
          type: "remote",
          url: "https://fixture.example/mcp",
          headers: { "X-Fixture": "1" },
          disabled: true,
        },
      },
    ])
    expect(state.mcpUpdates).toHaveLength(1)
    expect(state.mcpUpdates[0].name).toBe("existing-mcp")
    expect((state.mcpUpdates[0].config as { disabled?: boolean }).disabled).toBe(true)
    expect(state.mcpRemovals).toEqual([])
  })

  it("#when registerV2ConfigDomains is called then provider and model diffs land on their domains", async () => {
    const state = createFakeCtx()
    await registerV2ConfigDomains(state.ctx, createFixtureHandler())

    expect(state.providerAdds).toHaveLength(1)
    expect(state.providerAdds[0].info.id).toBe("fixture-provider")
    expect(state.providerAdds[0].info.name).toBe("Fixture Provider")
    expect(state.providerAdds[0].info.package).toBe("@ai-sdk/fixture")
    expect(state.providerAdds[0].models).toHaveLength(1)

    expect(state.providerUpdates).toHaveLength(1)
    expect(state.providerUpdates[0].id).toBe("prov-1")
    expect(state.providerUpdates[0].provider.name).toBe("Provider One")

    expect(state.providerModelSets).toHaveLength(1)
    expect(state.providerModelSets[0].providerID).toBe("prov-1")
    expect(state.providerModelSets[0].models).toHaveLength(2)

    expect(state.providerRemovals).toEqual([])
    expect(state.modelDefaults).toEqual([{ providerID: "prov-1", modelID: "mod-2" }])
  })
})

describe("#given a V2 list that rejects", () => {
  it("#when registerV2ConfigDomains is called then the seed survives and every handler agent emits a file", async () => {
    const state = createFakeCtx()
    state.ctx.agent.list = async () => {
      throw new Error("fixture list failure")
    }
    await registerV2ConfigDomains(state.ctx, createFixtureHandler())
    const agentsDir = join(tempConfigRoot, "agents")
    expect(state.agentUpdates).toHaveLength(0)
    expect(existsSync(join(agentsDir, "existing-agent.md"))).toBe(true)
    expect(existsSync(join(agentsDir, "new-fixture-agent.md"))).toBe(true)
    expect(existsSync(join(agentsDir, "second-fixture-agent.md"))).toBe(true)
    expect(state.getAgentReloadCalls()).toBe(1)
    expect(state.commandAdds).toHaveLength(1)
    expect(state.mcpSets).toHaveLength(1)
  })
})

describe("#given a handler that mutates nothing", () => {
  it("#when registerV2ConfigDomains is called then no transform is invoked", async () => {
    const state = createFakeCtx()
    await registerV2ConfigDomains(state.ctx, async () => {})
    expect(state.getTransformCalls()).toBe(0)
  })
})
