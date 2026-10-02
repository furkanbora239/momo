import { describe, expect, it } from "bun:test"
import type { V2PluginContext } from "./types"
import { convertV1CommandDefinition, type V2PromptSender } from "./command-config-converter"

type PromptCall = { sessionID: string; text: string; files?: unknown; agents?: unknown; skills?: unknown }

function createPromptSender() {
  const calls: PromptCall[] = []
  const sender: V2PromptSender = async (input) => {
    calls.push(input)
    return undefined
  }
  return { sender, calls }
}

describe("#given a V1 command template entry", () => {
  it("#when convertV1CommandDefinition is called then name and description carry over", () => {
    const { sender } = createPromptSender()
    const definition = convertV1CommandDefinition(
      "fixture-command",
      { template: "fixture template", description: "fixture description" },
      sender,
    )
    expect(definition.name).toBe("fixture-command")
    expect(definition.description).toBe("fixture description")
    expect(typeof definition.execute).toBe("function")
  })

  it("#when execute runs then the invocation prompt is delivered to the session", async () => {
    const { sender, calls } = createPromptSender()
    const definition = convertV1CommandDefinition(
      "fixture-command",
      { template: "fixture template", description: "fixture description" },
      sender,
    )
    await definition.execute({
      sessionID: "sess-1" as never,
      prompt: { text: "fixture prompt text" } as never,
      delivery: "queue" as never,
    })
    expect(calls).toEqual([{ sessionID: "sess-1", text: "fixture prompt text" }])
  })

  it("#when execute runs with attachments then they ride along with the prompt", async () => {
    const { sender, calls } = createPromptSender()
    const definition = convertV1CommandDefinition("fixture-command", { template: "t" }, sender)
    const files = [{ uri: "file:///fixture.txt" }]
    const agents = [{ name: "fixture-agent" }]
    await definition.execute({
      sessionID: "sess-1" as never,
      prompt: { text: "fixture text", files, agents } as never,
      delivery: "steer" as never,
    })
    expect(calls[0].text).toBe("fixture text")
    expect(calls[0].files).toEqual([{ uri: "file:///fixture.txt" }])
    expect(calls[0].agents).toEqual([{ name: "fixture-agent" }])
  })

  it("#when execute runs with no attachments then the keys are omitted", async () => {
    const { sender, calls } = createPromptSender()
    const definition = convertV1CommandDefinition("fixture-command", { template: "t" }, sender)
    await definition.execute({
      sessionID: "sess-1" as never,
      prompt: { text: "plain text" } as never,
      delivery: "queue" as never,
    })
    expect(calls).toEqual([{ sessionID: "sess-1", text: "plain text" }])
    expect("files" in calls[0]).toBe(false)
    expect("agents" in calls[0]).toBe(false)
  })
})

describe("#given the plugin context wiring", () => {
  it("#when the sender is bound to ctx.session.prompt then inputs match the V2 client", async () => {
    const prompts: unknown[] = []
    const ctx = {
      session: {
        prompt: async (input: unknown) => {
          prompts.push(input)
          return undefined
        },
      },
    } as unknown as V2PluginContext
    const definition = convertV1CommandDefinition("fixture-command", { template: "t" }, (input) =>
      ctx.session.prompt(input),
    )
    await definition.execute({
      sessionID: "sess-9" as never,
      prompt: { text: "wired text" } as never,
      delivery: "queue" as never,
    })
    expect(prompts).toEqual([{ sessionID: "sess-9", text: "wired text" }])
  })
})
