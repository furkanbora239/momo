import { describe, expect, it } from "bun:test"
import { buildContextMessageViews, type ContextMessageAdapterLogOnce } from "./context-message-adapter"

function createLogRecorder(): { logOnce: ContextMessageAdapterLogOnce; keys: string[] } {
  const keys: string[] = []
  const seen = new Set<string>()
  return {
    keys,
    logOnce: (key) => {
      if (seen.has(key)) return
      seen.add(key)
      keys.push(key)
    },
  }
}

describe("buildContextMessageViews", () => {
  it("pairs cross-message tool-call/tool-result parts into one V1 tool part", () => {
    // given
    const { logOnce } = createLogRecorder()
    const messages = [
      { id: "a1", role: "assistant", content: [{ type: "tool-call", id: "call_1", name: "bash", input: { command: "ls" } }] },
      { id: "t1", role: "tool", content: [{ type: "tool-result", id: "call_1", name: "bash", result: { type: "text", value: "out" } }] },
    ]

    // when
    const built = buildContextMessageViews("sess-1", messages as never[], logOnce)

    // then
    expect(built.views).toHaveLength(1)
    const part = built.views[0]?.parts[0] as { type: string; callID: string; tool: string; state: { status: string; output?: string } }
    expect(part.type).toBe("tool")
    expect(part.callID).toBe("call_1")
    expect(part.state.status).toBe("completed")
    expect(part.state.output).toBe("out")
  })

  it("keeps unpaired tool-calls pending and skips unmapped roles with a log-once", () => {
    // given
    const { logOnce, keys } = createLogRecorder()
    const messages = [
      { id: "a1", role: "assistant", content: [{ type: "tool-call", id: "call_1", name: "bash", input: {} }] },
      { id: "sys1", role: "system", content: [{ type: "text", text: "note" }] },
    ]

    // when
    const built = buildContextMessageViews("sess-1", messages as never[], logOnce)

    // then
    expect(built.views).toHaveLength(1)
    expect((built.views[0]?.parts[0] as { state: { status: string } }).state.status).toBe("pending")
    expect(keys).toEqual(["unmapped-role:system"])
  })

  it("adapts user text and metadata into V1-shaped views", () => {
    // given
    const { logOnce } = createLogRecorder()
    const messages = [{ id: "u1", role: "user", content: [{ type: "text", text: "hi", metadata: { weight: 2 } }] }]

    // when
    const built = buildContextMessageViews("sess-1", messages as never[], logOnce)

    // then
    expect(built.views[0]?.info).toMatchObject({ id: "u1", sessionID: "sess-1", role: "user" })
    expect(built.views[0]?.parts[0]).toMatchObject({ type: "text", text: "hi", metadata: { weight: 2 } })
    expect(built.tracked[0]?.snapshot.length ?? 0).toBeGreaterThan(0)
  })
})
