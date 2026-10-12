import { describe, expect, it } from "bun:test"
import type { OpenCodeEvent } from "@opencode/client"
import { mapV2TaskEvent } from "./v2-event-adapter"

describe("native V2 event adapter", () => {
  it("preserves the durable execution sequence for out-of-order delivery", () => {
    const event: OpenCodeEvent = { id: "end", created: 1, type: "session.execution.succeeded", durable: { aggregateID: "ses", seq: 42, version: 1 }, data: { sessionID: "ses" } }
    expect(mapV2TaskEvent(event)).toMatchObject({ type: "execution.succeeded", sequence: 42 })
  })
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
