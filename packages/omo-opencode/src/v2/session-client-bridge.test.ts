import { describe, expect, it } from "bun:test"
import { createSessionClientBridge } from "./session-client-bridge"
import type { V2PluginContext } from "./types"

type RecordedCall = { method: string; args: unknown }

function createFakeCtx(options?: { failOn?: string }) {
  const calls: RecordedCall[] = []
  const sessionInfo = {
    id: "sess-1",
    projectID: "proj-1",
    title: "main session",
    parentID: "sess-parent",
    time: { created: 100, updated: 200 },
    location: { directory: "/repo" },
    cost: 0.5,
    tokens: { input: 10, output: 20, reasoning: 0, cache: { read: 0, write: 0 } },
  }
  const record =
    <TResult>(method: string, result?: TResult) =>
    async (args: unknown): Promise<TResult> => {
      calls.push({ method, args })
      if (options?.failOn === method) {
        throw new Error("v2 ctx failure")
      }
      return result as TResult
    }
  const ctx = {
    session: {
      get: record("get", sessionInfo),
      create: record("create", { ...sessionInfo, id: "sess-new" }),
      remove: record("remove"),
      interrupt: record("interrupt", { interrupted: true }),
      compact: record("compact", {
        id: "inbox-1",
        sessionID: "sess-1",
        time: { created: 1 },
        type: "compaction",
        payload: {},
        delivery: "queue",
      }),
      context: record("context", [
        { id: "msg_u_1", time: { created: 10 }, type: "user", text: "hello" },
        {
          id: "msg_a_1",
          time: { created: 20, completed: 21 },
          type: "assistant",
          agent: "build",
          model: { id: "glm-5.3", providerID: "opencode-go" },
          cost: 0.01,
          tokens: { input: 1, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
          content: [{ type: "text", text: "answer" }],
        },
      ]),
      switchAgent: record("switchAgent"),
      switchModel: record("switchModel"),
      prompt: record("prompt", {
        id: "inbox-2",
        sessionID: "sess-1",
        time: { created: 2 },
        type: "user",
        payload: { text: "run" },
        delivery: "queue",
      }),
    },
  } as unknown as V2PluginContext
  return { ctx, calls }
}

describe("createSessionClientBridge", () => {
  it("delegates get with the V1 nested path flattened onto ctx.session.get", async () => {
    // given — call shape copied from tools/call-omo-agent/session-creator.ts
    const { ctx, calls } = createFakeCtx()
    const session = createSessionClientBridge(ctx)

    // when
    const result = await session.get({ path: { id: "sess-1" } })

    // then
    expect(calls).toEqual([{ method: "get", args: { sessionID: "sess-1" } }])
    expect(result.error).toBeUndefined()
    expect(result.data?.id).toBe("sess-1")
    expect(result.data?.directory).toBe("/repo")
    expect(result.data?.parentID).toBe("sess-parent")
  })

  it("delegates create with body and query flattened onto ctx.session.create", async () => {
    // given — call shape copied from tools/call-omo-agent/session-creator.ts
    const { ctx, calls } = createFakeCtx()
    const session = createSessionClientBridge(ctx)

    // when
    const result = await session.create({
      body: {
        parentID: "sess-parent",
        title: "do work (@explore subagent)",
        model: { id: "glm-5.3", providerID: "opencode-go", variant: "flash" },
      },
      query: { directory: "/repo" },
    })

    // then
    expect(calls).toEqual([
      {
        method: "create",
        args: {
          parentID: "sess-parent",
          title: "do work (@explore subagent)",
          model: { id: "glm-5.3", providerID: "opencode-go", variant: "flash" },
          location: { directory: "/repo" },
        },
      },
    ])
    expect(result.error).toBeUndefined()
    expect(result.data?.id).toBe("sess-new")
    expect(result.data?.directory).toBe("/repo")
  })

  it("delegates abort onto ctx.session.interrupt and surfaces the interrupted flag", async () => {
    // given — call shape copied from tools/delegate-task/sync-task.ts
    const { ctx, calls } = createFakeCtx()
    const session = createSessionClientBridge(ctx)

    // when
    const result = await session.abort({ path: { id: "sess-1" } })

    // then
    expect(calls).toEqual([{ method: "interrupt", args: { sessionID: "sess-1" } }])
    expect(result).toEqual({ data: true, error: undefined })
  })

  it("delegates delete onto ctx.session.remove and reports the resolved removal", async () => {
    // given
    const { ctx, calls } = createFakeCtx()
    const session = createSessionClientBridge(ctx)

    // when
    const result = await session.delete({ path: { id: "sess-1" } })

    // then
    expect(calls).toEqual([{ method: "remove", args: { sessionID: "sess-1" } }])
    expect(result).toEqual({ data: true, error: undefined })
  })

  it("delegates messages onto ctx.session.context and adapts the records", async () => {
    // given — call shape copied from tools/delegate-task/sync-result-fetcher.ts
    const { ctx, calls } = createFakeCtx()
    const session = createSessionClientBridge(ctx)

    // when
    const result = await session.messages({ path: { id: "sess-1" } })

    // then
    expect(calls).toEqual([{ method: "context", args: { sessionID: "sess-1" } }])
    expect(result.error).toBeUndefined()
    expect(result.data).toHaveLength(2)
    expect(result.data?.[0]).toEqual({
      info: { id: "msg_u_1", sessionID: "sess-1", role: "user", time: { created: 10 } },
      parts: [{ type: "text", text: "hello" }],
    })
    expect(result.data?.[1]?.info.role).toBe("assistant")
    expect(result.data?.[1]?.info.modelID).toBe("glm-5.3")
    expect(result.data?.[1]?.parts).toEqual([{ type: "text", text: "answer" }])
  })

  it("delegates summarize onto ctx.session.compact and resolves true", async () => {
    // given — call shape copied from hooks/preemptive-compaction-trigger.ts
    const { ctx, calls } = createFakeCtx()
    const session = createSessionClientBridge(ctx)

    // when
    const result = await session.summarize({
      path: { id: "sess-1" },
      body: { providerID: "opencode-go", modelID: "glm-5.3", auto: true },
      query: { directory: "/repo" },
    })

    // then
    expect(calls).toEqual([{ method: "compact", args: { sessionID: "sess-1" } }])
    expect(result).toEqual({ data: true, error: undefined })
  })

  it("delegates promptAsync via switchAgent, switchModel and prompt", async () => {
    // given — call shape copied from features/background-agent/spawner.ts + task-prompt-body.ts
    const { ctx, calls } = createFakeCtx()
    const session = createSessionClientBridge(ctx)

    // when
    const result = await session.promptAsync({
      path: { id: "sess-1" },
      body: {
        agent: "explore",
        model: { providerID: "opencode-go", modelID: "glm-5.3" },
        system: "extra system prompt",
        tools: { bash: true },
        parts: [{ type: "text", text: "run the tests" }],
      },
      query: { directory: "/repo" },
    })

    // then
    expect(calls).toEqual([
      { method: "switchAgent", args: { sessionID: "sess-1", agent: "explore" } },
      { method: "switchModel", args: { sessionID: "sess-1", model: { id: "glm-5.3", providerID: "opencode-go" } } },
      { method: "prompt", args: { sessionID: "sess-1", text: "run the tests" } },
    ])
    expect(result).toEqual({ data: undefined, error: undefined })
  })

  it("wraps ctx failures into the V1 error envelope instead of throwing", async () => {
    // given
    const { ctx } = createFakeCtx({ failOn: "get" })
    const session = createSessionClientBridge(ctx)

    // when
    const result = await session.get({ path: { id: "sess-1" } })

    // then
    expect(result.data).toBeUndefined()
    expect((result.error as Error).message).toBe("v2 ctx failure")
  })

  it("keeps the unmappable used methods as no-ops resolving undefined", async () => {
    // given — todo call shape copied from tools/task/todo-sync.ts
    const { ctx, calls } = createFakeCtx()
    const session = createSessionClientBridge(ctx)

    // when
    const todo = await session.todo({ path: { id: "sess-1" } })
    const status = await session.status()

    // then
    expect(todo).toBeUndefined()
    expect(status).toBeUndefined()
    expect(calls).toEqual([])
  })
})
