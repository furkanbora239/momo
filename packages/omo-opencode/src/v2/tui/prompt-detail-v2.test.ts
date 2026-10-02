import { describe, expect, it } from "bun:test"

import type { SubagentRow } from "../../features/subagent-tree"
import { showPromptDetailV2, readSubagentPromptV2 } from "./prompt-detail-v2"
import { createFakeV2TuiContext } from "./fake-tui-context"
import { createV2TuiFacade } from "./tui-facade"

function row(overrides: Partial<SubagentRow> = {}): SubagentRow {
  return {
    id: "row-1",
    sessionId: "sess-42",
    parentId: null,
    agent: "explore",
    modelID: "provider/model",
    taskLabel: "search the repo",
    promptPreview: null,
    status: "running",
    startedAt: null,
    toolCalls: null,
    lastTool: null,
    activeTool: null,
    ...overrides,
  }
}

describe("#given a session with a cached user message", () => {
  it("#when reading the prompt #then the cached text is returned without sync or fetch", async () => {
    const fake = createFakeV2TuiContext({
      messages: [{ type: "assistant", text: "working" }, { type: "user", text: "  do the thing  " }],
    })

    const prompt = await readSubagentPromptV2(fake.ctx, "sess-42")

    expect(prompt).toBe("do the thing")
    expect(fake.messageSyncs).toHaveLength(0)
    expect(fake.clientMessageListCalls).toHaveLength(0)
  })
})

describe("#given a session whose cache has no user message", () => {
  it("#when reading the prompt #then the cache is synced and re-read before fetching", async () => {
    const fake = createFakeV2TuiContext({
      messages: [{ type: "assistant", text: "working" }],
      fetchedMessages: [{ type: "user", text: "fetched prompt" }],
    })

    const prompt = await readSubagentPromptV2(fake.ctx, "sess-42")

    expect(prompt).toBe("fetched prompt")
    expect(fake.messageSyncs).toEqual(["sess-42"])
    expect(fake.clientMessageListCalls).toHaveLength(1)
    expect(fake.clientMessageListCalls[0]).toMatchObject({
      sessionID: "sess-42",
      type: "user",
      order: "asc",
      limit: 1,
    })
  })
})

describe("#given a session with no readable prompt anywhere", () => {
  it("#when reading the prompt #then it degrades to null", async () => {
    const fake = createFakeV2TuiContext({ messages: [], fetchedMessages: [] })

    const prompt = await readSubagentPromptV2(fake.ctx, "sess-42")

    expect(prompt).toBeNull()
  })
})

describe("#given a subagent row and a prompt", () => {
  it("#when showing the detail dialog #then a select dialog is shown and resolving it reopens the tasks", async () => {
    const fake = createFakeV2TuiContext({
      messages: [{ type: "user", text: "the orchestrator prompt" }],
    })
    const facade = createV2TuiFacade(fake.ctx)
    const reopened: string[] = []

    await showPromptDetailV2(fake.ctx, facade, row(), () => reopened.push("tasks"))

    expect(fake.dialogSelects).toHaveLength(1)
    const options = fake.dialogSelects[0]?.options ?? []
    expect(options[0]?.title).toBe("Back to subagent tasks")
    expect(options.some((option) => option.title === "explore · provider/model · running")).toBe(
      true,
    )
    expect(options.some((option) => option.title === "the orchestrator prompt")).toBe(true)
    expect(reopened).toEqual(["tasks"])
    expect(fake.renderRequests).toBe(1)
  })

  it("#when the row has no session id #then the prompt degrades and the fallback line renders", async () => {
    const fake = createFakeV2TuiContext({ messages: [] })
    const facade = createV2TuiFacade(fake.ctx)

    await showPromptDetailV2(fake.ctx, facade, row({ sessionId: null }), () => undefined)

    expect(fake.clientMessageListCalls).toHaveLength(0)
    const options = fake.dialogSelects[0]?.options ?? []
    expect(options.some((option) => option.title === "prompt not synced yet")).toBe(true)
  })
})
