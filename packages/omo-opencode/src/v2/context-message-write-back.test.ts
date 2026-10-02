import { describe, expect, it } from "bun:test"
import { buildContextMessageViews, type ContextMessageAdapterLogOnce } from "./context-message-adapter"
import { applyContextMessageWriteBack } from "./context-message-write-back"

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

function event(messages: unknown[]): { readonly sessionID: string; messages: never[] } {
  return { sessionID: "sess-1", messages: messages as never[] }
}

describe("applyContextMessageWriteBack", () => {
  it("syncs user text edits in place and preserves untracked media entries", () => {
    // given
    const { logOnce } = createLogRecorder()
    const mediaEntry = { type: "media", media: { source: { type: "url", url: "file:///a.png", mediaType: "image/png" } } }
    const userMessage = { id: "u1", role: "user", content: [{ type: "text", text: "hi" }, mediaEntry] }
    const e = event([userMessage])
    const built = buildContextMessageViews("sess-1", e.messages, logOnce)
    ;(built.views[0]!.parts[0] as { text: string }).text = "TRANSLATED"

    // when
    applyContextMessageWriteBack(e, built, built.views, logOnce)

    // then
    const content = (e.messages[0] as { content: Array<{ type: string; text?: string }> }).content
    expect(content).toHaveLength(2)
    expect(content[0]?.text).toBe("TRANSLATED")
    expect(content[1]).toBe(mediaEntry)
  })

  it("rebuilds user content from the final part order when handlers insert parts", () => {
    // given
    const { logOnce } = createLogRecorder()
    const mediaEntry = { type: "media", media: { source: { type: "url", url: "file:///a.png", mediaType: "image/png" } } }
    const userMessage = { id: "u1", role: "user", content: [{ type: "text", text: "hi" }, mediaEntry] }
    const e = event([userMessage])
    const built = buildContextMessageViews("sess-1", e.messages, logOnce)

    // when
    const originalTextPart = built.views[0]!.parts[0]!
    built.views[0]!.parts.splice(0, 0, {
      id: "injected", sessionID: "sess-1", messageID: "u1", type: "text", text: "REPO-MAP",
    } as never)
    built.views[0]!.parts[1] = originalTextPart
    applyContextMessageWriteBack(e, built, built.views, logOnce)

    // then
    const content = (e.messages[0] as { content: Array<{ type: string; text?: string }> }).content
    expect(content[0]?.text).toBe("REPO-MAP")
    expect(content[1]?.text).toBe("hi")
    expect(content[2]).toBe(mediaEntry)
  })

  it("inserts pushed views before the next tracked source and removes deleted views", () => {
    // given
    const { logOnce } = createLogRecorder()
    const userMessage = { id: "u1", role: "user", content: [{ type: "text", text: "hi" }] }
    const e = event([userMessage])
    const built = buildContextMessageViews("sess-1", e.messages, logOnce)

    // when
    const pushed = {
      info: { id: "new_msg", sessionID: "sess-1", role: "user" as const, time: { created: 1 }, agent: "default", model: { providerID: "", modelID: "" } },
      parts: [{ id: "new_part", sessionID: "sess-1", messageID: "new_msg", type: "text" as const, text: "STATUS-LINE" }],
    }
    built.views.pop()
    applyContextMessageWriteBack(e, built, [pushed], logOnce)

    // then
    expect(e.messages).toHaveLength(1)
    expect((e.messages[0] as { content: Array<{ type: string; text?: string }> }).content[0]?.text).toBe("STATUS-LINE")
  })

  it("degrades structural changes on assistant views without rebuilding V2 content", () => {
    // given
    const { logOnce, keys } = createLogRecorder()
    const toolCallEntry = { type: "tool-call", id: "call_1", name: "bash", input: { command: "ls" } }
    const assistantMessage = { id: "a1", role: "assistant", content: [toolCallEntry] }
    const e = event([assistantMessage])
    const built = buildContextMessageViews("sess-1", e.messages, logOnce)
    const originalEntry = assistantMessage.content[0]

    // when — a handler appends a part to the assistant view
    built.views[0]!.parts.push({
      id: "extra", sessionID: "sess-1", messageID: "a1", type: "text", text: "APPENDED",
    } as never)
    applyContextMessageWriteBack(e, built, built.views, logOnce)

    // then — the V2 content entry is untouched (reference preserved), degradation logged
    expect(assistantMessage.content[0]).toBe(originalEntry)
    expect(e.messages).toHaveLength(1)
    expect(keys).toEqual(["assistant-view-structure"])
  })
})
