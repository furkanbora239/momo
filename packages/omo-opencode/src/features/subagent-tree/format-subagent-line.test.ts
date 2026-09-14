import { describe, expect, it } from "bun:test"

import { formatSubagentLine } from "./format-subagent-line"
import type { SubagentRow } from "./types"

function row(input: Partial<SubagentRow> = {}): SubagentRow {
  return {
    id: "row-1",
    parentId: null,
    agent: "explore",
    modelID: null,
    taskLabel: "Index the repository",
    promptPreview: null,
    status: "running",
    startedAt: null,
    toolCalls: null,
    lastTool: null,
    activeTool: null,
    ...input,
  }
}

describe("formatSubagentLine", () => {
  it("#given a full row #when formatting #then it includes agent model task and status", () => {
    // given
    const subagent = row({
      agent: "librarian",
      modelID: "google/gemini-2.5-flash",
      taskLabel: "Read docs",
      status: "running",
    })

    // when
    const line = formatSubagentLine(subagent, 0)

    // then
    expect(line).toContain("librarian")
    expect(line).toContain("google/gemini-2.5-flash")
    expect(line).toContain("Read docs")
    expect(line).toContain("running")
  })

  it("#given a row with an active tool #when formatting #then it appends the running suffix", () => {
    // given
    const subagent = row({ activeTool: "bash" })

    // when
    const line = formatSubagentLine(subagent, 0)

    // then
    expect(line).toContain("[Running: bash]")
  })

  it("#given a row without an active tool #when formatting #then it omits the running suffix", () => {
    // given
    const subagent = row({ activeTool: null })

    // when
    const line = formatSubagentLine(subagent, 0)

    // then
    expect(line).not.toContain("[Running:")
  })

  it("#given a row without a model #when formatting #then it labels the model unknown", () => {
    // given
    const subagent = row({ modelID: null })

    // when
    const line = formatSubagentLine(subagent, 0)

    // then
    expect(line).toContain("model unknown")
  })

  it("#given a prompt preview #when formatting #then it prefers the preview over the task label", () => {
    // given
    const subagent = row({
      taskLabel: "Fallback label",
      promptPreview: "Find every caller of renderSidebar",
    })

    // when
    const line = formatSubagentLine(subagent, 0)

    // then
    expect(line).toContain("Find every caller of renderSidebar")
    expect(line).not.toContain("Fallback label")
  })

  it("#given a depth #when formatting #then it indents by two spaces per level", () => {
    // given
    const subagent = row({ agent: "worker" })

    // when
    const line = formatSubagentLine(subagent, 2)

    // then
    expect(line.startsWith("    worker")).toBe(true)
  })
})
