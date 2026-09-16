import { describe, expect, it } from "bun:test"

import type { FlatSubagentNode } from "./build-subagent-tree"
import type { SubagentRow } from "./types"
import {
  TASK_PREVIEW_MAX_COLS,
  buildTaskCards,
  taskBodyLines,
  taskStatusTone,
  truncateTaskPreview,
} from "./task-cards"

function row(input: Partial<SubagentRow> = {}): SubagentRow {
  return {
    id: "row-1",
    sessionId: "session-1",
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

function flat(input: { row: SubagentRow; depth: number }): FlatSubagentNode {
  return input
}

describe("truncateTaskPreview", () => {
  it("#given a short preview #when truncating #then it is unchanged", () => {
    expect(truncateTaskPreview("short", 60)).toBe("short")
  })

  it("#given a long preview #when truncating #then it clips to the column budget", () => {
    const value = "x".repeat(100)
    const truncated = truncateTaskPreview(value, 60)
    expect(truncated).toHaveLength(60)
    expect(truncated.endsWith("...")).toBe(true)
  })
})

describe("taskStatusTone", () => {
  it("#given a running status #when mapping #then it is positive", () => {
    expect(taskStatusTone("running")).toBe("positive")
  })

  it("#given queued or pending statuses #when mapping #then they are warnings", () => {
    expect(taskStatusTone("queued")).toBe("warning")
    expect(taskStatusTone("pending")).toBe("warning")
    expect(taskStatusTone("interrupt")).toBe("warning")
  })

  it("#given terminal failure statuses #when mapping #then they are negative", () => {
    expect(taskStatusTone("error")).toBe("negative")
    expect(taskStatusTone("cancelled")).toBe("negative")
  })

  it("#given a completed status #when mapping #then it is muted", () => {
    expect(taskStatusTone("completed")).toBe("muted")
  })

  it("#given an unknown status #when mapping #then it is neutral", () => {
    expect(taskStatusTone("mystery")).toBe("neutral")
  })
})

describe("taskBodyLines", () => {
  it("#given a row without a model #when building body lines #then it reports the model unknown", () => {
    const lines = taskBodyLines(row({ modelID: null }))
    expect(lines).toContain("model unknown")
  })

  it("#given a row with a model #when building body lines #then it carries the model id", () => {
    const lines = taskBodyLines(row({ modelID: "google/gemini-3-flash" }))
    expect(lines).toContain("google/gemini-3-flash")
  })

  it("#given an active tool #when building body lines #then it appends the running tool", () => {
    const lines = taskBodyLines(row({ activeTool: "bash" }))
    expect(lines).toContain("[Running: bash]")
  })

  it("#given no active tool #when building body lines #then no running marker appears", () => {
    const lines = taskBodyLines(row({ activeTool: null }))
    expect(lines.some((line) => line.startsWith("[Running:"))).toBe(false)
  })

  it("#given a long prompt preview #when building body lines #then the preview is truncated", () => {
    const lines = taskBodyLines(row({ promptPreview: "y".repeat(200) }))
    const preview = lines.find((line) => line.startsWith("y"))
    expect(preview).toHaveLength(TASK_PREVIEW_MAX_COLS)
  })

  it("#given no prompt preview #when building body lines #then the task label is used", () => {
    const lines = taskBodyLines(row({ promptPreview: null, taskLabel: "Index the repository" }))
    expect(lines).toContain("Index the repository")
  })
})

describe("buildTaskCards", () => {
  it("#given a flat tree #when building cards #then each row becomes a card with depth indent", () => {
    const cards = buildTaskCards([
      flat({ row: row({ agent: "explore" }), depth: 0 }),
      flat({ row: row({ agent: "worker", parentId: "row-1" }), depth: 1 }),
    ])
    expect(cards).toHaveLength(2)
    expect(cards[0].indent).toBe(0)
    expect(cards[1].indent).toBe(1)
    expect(cards[1].title).toBe("worker")
  })

  it("#given rows #when building cards #then the badge carries the status tone", () => {
    const cards = buildTaskCards([
      flat({ row: row({ status: "running" }), depth: 0 }),
      flat({ row: row({ status: "error" }), depth: 0 }),
    ])
    expect(cards[0].badge?.text).toBe("running")
    expect(cards[0].badge?.tone).toBe("positive")
    expect(cards[1].badge?.tone).toBe("negative")
  })

  it("#given rows #when building cards #then ids stay unique", () => {
    const cards = buildTaskCards([
      flat({ row: row(), depth: 0 }),
      flat({ row: row(), depth: 1 }),
    ])
    expect(new Set(cards.map((card) => card.id)).size).toBe(cards.length)
  })
})
