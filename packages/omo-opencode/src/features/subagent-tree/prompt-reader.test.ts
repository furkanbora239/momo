import { describe, expect, it } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk/v2"

import { extractSubagentPrompt, promptDetailLines } from "./prompt-reader"

function userMessage(id: string): Message {
  return {
    id,
    sessionID: "ses-child",
    role: "user",
    time: { created: 1 },
    agent: "orchestrator",
    model: { providerID: "p", modelID: "m" },
  }
}

function assistantMessage(id: string): Message {
  return {
    id,
    sessionID: "ses-child",
    role: "assistant",
    time: { created: 2 },
    parentID: "msg-user",
    modelID: "m",
    providerID: "p",
    mode: "build",
    path: { cwd: "/x", root: "/x" },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: { read: 0, write: 0 },
    },
  }
}

function textPart(messageID: string, text: string): Part {
  return { id: `p-${messageID}-t`, sessionID: "ses-child", messageID, type: "text", text }
}

function syntheticPart(messageID: string): Part {
  return {
    id: `p-${messageID}-s`,
    sessionID: "ses-child",
    messageID,
    type: "text",
    text: "injected context",
    synthetic: true,
  }
}

function subtaskPart(messageID: string, prompt: string): Part {
  return {
    id: `p-${messageID}-sub`,
    sessionID: "ses-child",
    messageID,
    type: "subtask",
    prompt,
    description: "Run the tests",
    agent: "explore",
  }
}

describe("extractSubagentPrompt", () => {
  it("#given a first user message with a subtask part #when extracting #then it returns the subtask prompt", () => {
    // given
    const messages = [userMessage("msg-1"), assistantMessage("msg-2")]
    const partsOf = (id: string): ReadonlyArray<Part> => [
      subtaskPart(id, "Map every caller of collectSubagentRows"),
      textPart(id, "stale draft text"),
    ]

    // when
    const prompt = extractSubagentPrompt(messages, partsOf)

    // then
    expect(prompt).toBe("Map every caller of collectSubagentRows")
  })

  it("#given a first user message with only visible text parts #when extracting #then it joins them and skips synthetic parts", () => {
    // given
    const messages = [userMessage("msg-1")]
    const partsOf = (id: string): ReadonlyArray<Part> => [
      syntheticPart(id),
      textPart(id, "first visible"),
      textPart(id, "second visible"),
    ]

    // when
    const prompt = extractSubagentPrompt(messages, partsOf)

    // then
    expect(prompt).toBe("first visible\nsecond visible")
  })

  it("#given no user message in the session #when extracting #then it returns null", () => {
    // given
    const messages = [assistantMessage("msg-1")]

    // when
    const prompt = extractSubagentPrompt(messages, () => [])

    // then
    expect(prompt).toBeNull()
  })

  it("#given a user message whose parts carry no text #when extracting #then it returns null", () => {
    // given
    const messages = [userMessage("msg-1")]
    const partsOf = (id: string): ReadonlyArray<Part> => [syntheticPart(id)]

    // when
    const prompt = extractSubagentPrompt(messages, partsOf)

    // then
    expect(prompt).toBeNull()
  })
})

describe("promptDetailLines", () => {
  it("#given a null prompt #when formatting #then it reports the prompt as unavailable", () => {
    // given

    // when
    const lines = promptDetailLines(null)

    // then
    expect(lines.join(" ")).toContain("Prompt unavailable")
  })

  it("#given a long prompt line #when formatting #then it wraps to the width cap", () => {
    // given
    const longLine = "x".repeat(250)

    // when
    const lines = promptDetailLines(longLine)

    // then
    expect(lines.every((line) => line.length <= 96)).toBe(true)
    expect(lines.join("")).toBe(longLine)
  })

  it("#given more lines than the cap #when formatting #then it truncates with a marker", () => {
    // given
    const prompt = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n")

    // when
    const lines = promptDetailLines(prompt)

    // then
    expect(lines).toHaveLength(61)
    expect(lines[60]).toContain("truncated")
  })
})
