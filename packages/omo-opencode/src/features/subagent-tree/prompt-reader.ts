import type { Message, Part } from "@opencode-ai/sdk/v2"

const WRAP_WIDTH = 96
const MAX_PROMPT_LINES = 60

export type SubagentPartsReader = (messageID: string) => ReadonlyArray<Part>

function isDisplayableTextPart(part: Part): part is Extract<Part, { type: "text" }> {
  return (
    part.type === "text" &&
    part.synthetic !== true &&
    part.ignored !== true &&
    part.text.trim().length > 0
  )
}

function promptFromParts(parts: ReadonlyArray<Part>): string | null {
  for (const part of parts) {
    if (part.type === "subtask" && part.prompt.trim().length > 0) {
      return part.prompt.trim()
    }
  }
  const texts = parts.filter(isDisplayableTextPart).map((part) => part.text.trim())
  if (texts.length === 0) {
    return null
  }
  return texts.join("\n")
}

/**
 * Extracts the prompt the orchestrator gave a subagent from the subagent's own
 * session: the first user message, preferring the delegate-task `subtask` part
 * prompt and falling back to its visible text parts. Returns null when the
 * session store has no readable user prompt.
 */
export function extractSubagentPrompt(
  messages: ReadonlyArray<Message>,
  partsOf: SubagentPartsReader,
): string | null {
  const firstUser = messages.find((message) => message.role === "user")
  if (firstUser === undefined) {
    return null
  }
  return promptFromParts(partsOf(firstUser.id))
}

function wrapLine(line: string): string[] {
  if (line.length <= WRAP_WIDTH) {
    return [line]
  }
  const wrapped: string[] = []
  let rest = line
  while (rest.length > WRAP_WIDTH) {
    wrapped.push(rest.slice(0, WRAP_WIDTH))
    rest = rest.slice(WRAP_WIDTH)
  }
  if (rest.length > 0) {
    wrapped.push(rest)
  }
  return wrapped
}

export function promptDetailLines(prompt: string | null): string[] {
  if (prompt === null || prompt.trim().length === 0) {
    return [
      "Prompt unavailable: the subagent session store has no readable",
      "first user message for this task.",
    ]
  }
  const lines = prompt.split("\n").flatMap(wrapLine)
  if (lines.length > MAX_PROMPT_LINES) {
    return [...lines.slice(0, MAX_PROMPT_LINES), `... truncated (${lines.length - MAX_PROMPT_LINES} more lines)`]
  }
  return lines
}
