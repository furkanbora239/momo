const { describe, test, expect } = require("bun:test")

import { resolveSubagentExecution } from "./subagent-resolver"
import type { ExecutorContext } from "./executor-types"

function makeCtx(availableAgents: string[]): ExecutorContext {
  return {
    client: {
      app: {
        agents: async () => ({
          data: availableAgents.map((name) => ({ name, description: `${name} agent`, mode: "subagent" })),
        }),
      },
      config: { get: async () => ({ data: {} }) },
    } as unknown as ExecutorContext["client"],
    manager: {} as unknown as ExecutorContext["manager"],
    directory: "/tmp/test",
  }
}

describe("explicit model override on named subagent delegation", () => {
  test("#given subagent_type=general with an explicit model param #when resolveSubagentExecution is called #then that exact model wins over the agent default chain", async () => {
    //#given
    const ctx = makeCtx(["general"])
    const args = {
      subagent_type: "general",
      prompt: "do something",
      load_skills: [],
      run_in_background: false,
      description: "explicit model delegation",
      model: "neuralwatt/glm-5.2",
    }

    //#when
    const result = await resolveSubagentExecution(args, ctx, "sisyphus", "")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("general")
    expect(result.categoryModel).toEqual({ providerID: "neuralwatt", modelID: "glm-5.2" })
  })

  test("#given subagent_type=general without a model param #when resolveSubagentExecution is called #then the model stays unset so the default chain resolves downstream", async () => {
    //#given
    const ctx = makeCtx(["general"])
    const args = {
      subagent_type: "general",
      prompt: "do something",
      load_skills: [],
      run_in_background: false,
      description: "default chain delegation",
    }

    //#when
    const result = await resolveSubagentExecution(args, ctx, "sisyphus", "")

    //#then
    expect(result.error).toBeUndefined()
    expect(result.agentToUse).toBe("general")
    expect(result.categoryModel).toBeUndefined()
  })
})
