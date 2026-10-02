import { describe, expect, it } from "bun:test"
import type { Agent } from "@opencode/plugin"
import type { DeepMutable } from "@opencode/plugin/promise/types"
import {
  applyV2AgentMutation,
  convertV1AgentEntry,
  convertV1PermissionToRules,
  convertV2AgentInfoToV1Entry,
  convertV2PermissionRulesToV1Map,
  parseV1ModelRef,
} from "./agent-config-converter"

describe("#given a V1 permission map", () => {
  it("#when convertV1PermissionToRules is called then actions rename and bash submaps expand", () => {
    const rules = convertV1PermissionToRules({
      edit: "allow",
      bash: { "rm *": "deny", "git status": "allow" },
      task: "ask",
      write: "deny",
      webfetch: "ask",
    })
    expect(rules).toEqual([
      { action: "edit", resource: "*", effect: "allow" },
      { action: "shell", resource: "rm *", effect: "deny" },
      { action: "shell", resource: "git status", effect: "allow" },
      { action: "subagent", resource: "*", effect: "ask" },
      { action: "edit", resource: "*", effect: "deny" },
      { action: "webfetch", resource: "*", effect: "ask" },
    ])
  })
})

describe("#given V2 permission rules", () => {
  it("#when convertV2PermissionRulesToV1Map is called then renames invert and bash re-nests", () => {
    const map = convertV2PermissionRulesToV1Map([
      { action: "edit", resource: "*", effect: "allow" },
      { action: "shell", resource: "rm *", effect: "deny" },
      { action: "subagent", resource: "*", effect: "ask" },
    ])
    expect(map).toEqual({ edit: "allow", bash: { "rm *": "deny" }, task: "ask" })
  })
})

describe("#given a V1 model string", () => {
  it("#when parseV1ModelRef is called then provider, model, and variant split", () => {
    expect(parseV1ModelRef("prov-1/mod-1")).toEqual({ id: "mod-1", providerID: "prov-1" })
    expect(parseV1ModelRef("prov-1/mod-1#fast")).toEqual({
      id: "mod-1",
      providerID: "prov-1",
      variant: "fast",
    })
    expect(parseV1ModelRef("provider-only")).toBeUndefined()
    expect(parseV1ModelRef("/mod-1")).toBeUndefined()
    expect(parseV1ModelRef("prov-1/")).toBeUndefined()
    expect(parseV1ModelRef("prov-1/#fast")).toBeUndefined()
  })
})

describe("#given a V1 agent entry", () => {
  it("#when convertV1AgentEntry is called then renames and nesting apply", () => {
    const mutation = convertV1AgentEntry("fixture-agent", {
      prompt: "fixture system prompt",
      model: "prov-1/mod-1#fast",
      disable: true,
      maxSteps: 12,
      temperature: 0.2,
      top_p: 0.9,
      description: "fixture description",
      mode: "subagent",
      color: "#123456",
      permission: { edit: "allow" },
    })
    expect(mutation).toEqual({
      id: "fixture-agent",
      name: "fixture-agent",
      system: "fixture system prompt",
      model: { id: "mod-1", providerID: "prov-1", variant: "fast" },
      disabled: true,
      steps: 12,
      temperature: 0.2,
      topP: 0.9,
      description: "fixture description",
      mode: "subagent",
      color: "#123456",
      permissions: [{ action: "edit", resource: "*", effect: "allow" }],
    })
  })
})

describe("#given a client agent record", () => {
  it("#when convertV2AgentInfoToV1Entry is called then V1 field names come back", () => {
    const entry = convertV2AgentInfoToV1Entry({
      id: "fixture-agent",
      name: "fixture-agent",
      mode: "subagent",
      hidden: false,
      permissions: [
        { action: "edit", resource: "*", effect: "allow" },
        { action: "shell", resource: "bun *", effect: "allow" },
      ],
      request: { settings: {}, headers: {}, body: { temperature: 0.4, top_p: 0.8 } },
      system: "fixture system from v2",
      description: "fixture description from v2",
      color: "#ABCDEF",
      steps: 7,
      model: { id: "mod-1", providerID: "prov-1", variant: "fast" },
    })
    expect(entry).toEqual({
      model: "prov-1/mod-1#fast",
      prompt: "fixture system from v2",
      description: "fixture description from v2",
      mode: "subagent",
      color: "#ABCDEF",
      maxSteps: 7,
      temperature: 0.4,
      top_p: 0.8,
      permission: { edit: "allow", bash: { "bun *": "allow" } },
    })
  })
})

describe("#given a mutable V2 agent skeleton", () => {
  it("#when applyV2AgentMutation is called then every present field lands", () => {
    const agent = {
      id: "fixture-agent",
      name: "fixture-agent",
      request: { settings: {}, headers: {}, body: {} },
      mode: "primary",
      hidden: false,
      permissions: [] as unknown[],
    } as unknown as DeepMutable<Agent.Info>
    applyV2AgentMutation(agent, {
      id: "fixture-agent",
      name: "fixture-agent",
      system: "fixture system",
      model: { id: "mod-1", providerID: "prov-1", variant: "fast" },
      mode: "subagent",
      steps: 9,
      permissions: [{ action: "shell", resource: "*", effect: "deny" }],
      temperature: 0.3,
      topP: 0.7,
      disabled: true,
    })
    expect(agent.system).toBe("fixture system")
    expect(agent.mode).toBe("subagent")
    expect(agent.steps).toBe(9)
    expect(agent.permissions).toEqual([{ action: "shell", resource: "*", effect: "deny" }])
    expect(agent.model).toEqual({ id: "mod-1", providerID: "prov-1", variant: "fast" })
    expect(agent.request.body).toEqual({ temperature: 0.3, top_p: 0.7 })
    expect((agent as { disabled?: boolean }).disabled).toBe(true)
  })

  it("#when the mutation omits fields then existing values are preserved", () => {
    const agent = {
      id: "fixture-agent",
      name: "kept-name",
      request: { settings: {}, headers: {}, body: { temperature: 0.5 } },
      mode: "all",
      hidden: false,
      permissions: [{ action: "edit", resource: "*", effect: "ask" }],
    } as unknown as DeepMutable<Agent.Info>
    applyV2AgentMutation(agent, { id: "fixture-agent", name: "fixture-agent", system: "only system" })
    expect(agent.name).toBe("kept-name")
    expect(agent.mode).toBe("all")
    expect(agent.permissions).toEqual([{ action: "edit", resource: "*", effect: "ask" }])
    expect(agent.request.body).toEqual({ temperature: 0.5 })
  })
})
