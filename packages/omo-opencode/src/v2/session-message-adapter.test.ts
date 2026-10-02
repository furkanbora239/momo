import { describe, expect, it } from "bun:test"
import { adaptSessionMessages, type V2SessionMessage } from "./session-message-adapter"

describe("adaptSessionMessages", () => {
  it("adapts user, synthetic and system records into V1 user messages", () => {
    // given
    const messages = [
      { id: "msg_u_1", time: { created: 10 }, type: "user", text: "hello" },
      { id: "msg_s_1", time: { created: 11 }, type: "synthetic", text: "injected" },
      { id: "msg_sys_1", time: { created: 12 }, type: "system", text: "system note" },
    ] satisfies V2SessionMessage[]

    // when
    const adapted = adaptSessionMessages(messages, "sess-1")

    // then
    expect(adapted).toEqual([
      {
        info: { id: "msg_u_1", sessionID: "sess-1", role: "user", time: { created: 10 } },
        parts: [{ type: "text", text: "hello" }],
      },
      {
        info: { id: "msg_s_1", sessionID: "sess-1", role: "user", time: { created: 11 } },
        parts: [{ type: "text", text: "injected", synthetic: true }],
      },
      {
        info: { id: "msg_sys_1", sessionID: "sess-1", role: "user", time: { created: 12 } },
        parts: [{ type: "text", text: "system note" }],
      },
    ])
  })

  it("adapts assistant records with info fields and content parts", () => {
    // given
    const messages: V2SessionMessage[] = [
      {
        id: "msg_a_1",
        time: { created: 20, completed: 21 },
        type: "assistant",
        agent: "build",
        model: { id: "glm-5.3", providerID: "opencode-go" },
        cost: 0.01,
        tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
        content: [
          { type: "text", text: "answer" },
          { type: "reasoning", text: "thinking" },
        ],
      },
    ]

    // when
    const adapted = adaptSessionMessages(messages, "sess-1")

    // then
    expect(adapted).toEqual([
      {
        info: {
          id: "msg_a_1",
          sessionID: "sess-1",
          role: "assistant",
          time: { created: 20, completed: 21 },
          agent: "build",
          modelID: "glm-5.3",
          providerID: "opencode-go",
          cost: 0.01,
          tokens: { input: 1, output: 2, reasoning: 3, cache: { read: 4, write: 5 } },
        },
        parts: [
          { type: "text", text: "answer" },
          { type: "reasoning", text: "thinking" },
        ],
      },
    ])
  })

  it("adapts tool content parts with their tool states", () => {
    // given
    const messages: V2SessionMessage[] = [
      {
        id: "msg_a_1",
        time: { created: 20 },
        type: "assistant",
        agent: "build",
        model: { id: "glm-5.3", providerID: "opencode-go" },
        content: [
          {
            type: "tool",
            id: "call_1",
            name: "bash",
            state: {
              status: "completed",
              input: { command: "ls" },
              content: [{ type: "text", text: "file-a" }, { type: "file", uri: "file:///a", mime: "text/plain" }],
              metadata: { attempt: 1 },
            },
          },
          {
            type: "tool",
            id: "call_2",
            name: "grep",
            state: { status: "streaming", input: "{\"q\":\"x\"}" },
          },
          {
            type: "tool",
            id: "call_3",
            name: "edit",
            state: {
              status: "error",
              input: { path: "a.ts" },
              error: { type: "tool", message: "hash mismatch", status: 400 },
            },
          },
        ],
      },
    ]

    // when
    const adapted = adaptSessionMessages(messages, "sess-1")

    // then
    expect(adapted[0]?.parts).toEqual([
      {
        type: "tool",
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls" },
          output: 'file-a\n{"type":"file","uri":"file:///a","mime":"text/plain","name":null}',
          metadata: { attempt: 1 },
        },
      },
      { type: "tool", callID: "call_2", tool: "grep", state: { status: "pending", input: {}, raw: "{\"q\":\"x\"}" } },
      {
        type: "tool",
        callID: "call_3",
        tool: "edit",
        state: { status: "error", input: { path: "a.ts" }, error: "hash mismatch" },
      },
    ])
  })

  it("drops bookkeeping records that have no V1 message equivalent", () => {
    // given
    const messages = [
      { id: "msg_i_1", time: { created: 30 }, type: "idle", outcome: "succeeded" },
      {
        id: "msg_c_1",
        time: { created: 31 },
        type: "compaction",
        status: "completed",
        reason: "auto",
        summary: "summary",
        recent: "recent",
      },
    ] satisfies V2SessionMessage[]

    // when
    const adapted = adaptSessionMessages(messages, "sess-1")

    // then
    expect(adapted).toEqual([])
  })
})
