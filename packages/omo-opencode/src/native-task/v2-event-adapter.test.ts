import { describe, expect, it } from "bun:test"
import type { OpenCodeEvent } from "@opencode/client"
import { mapV2TaskEvent } from "./v2-event-adapter"

describe("native V2 event adapter", () => {
  it("reports throttled progress for streamed tool input without marking a tool active", () => {
    const sessionID = `ses-input-${crypto.randomUUID()}`
    const event = (id: string): OpenCodeEvent => ({
      id,
      created: Date.now(),
      type: "session.tool.input.delta",
      data: { sessionID, assistantMessageID: "msg-assistant", id: "tool-call", delta: "{\"command\":" },
    })

    expect(mapV2TaskEvent(event("input-first"))).toMatchObject({ type: "progress", sessionID })
    expect(mapV2TaskEvent(event("input-fast-second"))).toBeUndefined()
  })
})
