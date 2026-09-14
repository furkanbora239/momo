import { describe, expect, it } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2"

import { extractSubagentPrompt } from "./prompt-reader"

function singleUserSession(prompt: string): {
  messages: ReadonlyArray<Message>
  partsOf: (messageID: string) => ReadonlyArray<Part>
} {
  const messages: Message[] = [
    {
      id: "msg-1",
      sessionID: "ses-child",
      role: "user",
      time: { created: 1 },
      agent: "orchestrator",
      model: { providerID: "p", modelID: "m" },
    },
  ]
  const partsOf = (id: string): ReadonlyArray<Part> => [
    { id: `p-${id}`, sessionID: "ses-child", messageID: id, type: "text", text: prompt },
  ]
  return { messages, partsOf }
}

describe("readSubagentPrompt wiring", () => {
  it("#given the extract contract #when session has a prompt #then the detail dialog receives readable lines", () => {
    // given
    const { messages, partsOf } = singleUserSession("Index the repository callers")

    // when
    const prompt = extractSubagentPrompt(messages, partsOf)
    const firstLine = prompt?.split("\n")[0] ?? null

    // then
    expect(firstLine).toBe("Index the repository callers")
  })
})
