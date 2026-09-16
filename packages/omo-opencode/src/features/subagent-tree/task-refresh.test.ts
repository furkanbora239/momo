import { describe, expect, it } from "bun:test"

import type { FlatSubagentNode } from "./build-subagent-tree"
import type { SubagentRow } from "./types"
import { focusIndexPreservingId, subagentSignature } from "./task-refresh"

function row(input: Partial<SubagentRow> = {}): SubagentRow {
  return {
    id: "row-1",
    sessionId: "session-1",
    parentId: null,
    agent: "explore",
    modelID: "google/gemini-3-flash",
    taskLabel: "Index the repository",
    promptPreview: "Find callers",
    status: "running",
    startedAt: null,
    toolCalls: 2,
    lastTool: "bash",
    activeTool: "bash",
    ...input,
  }
}

function flat(input: { row: SubagentRow; depth: number }): FlatSubagentNode {
  return input
}

describe("subagentSignature", () => {
  it("#given identical trees #when signing #then the signatures match", () => {
    const lines = [flat({ row: row(), depth: 0 })]
    expect(subagentSignature(lines)).toBe(subagentSignature(lines))
  })

  it("#given a status change #when signing #then the signature changes", () => {
    const before = subagentSignature([flat({ row: row(), depth: 0 })])
    const after = subagentSignature([flat({ row: row({ status: "completed" }), depth: 0 })])
    expect(after).not.toBe(before)
  })

  it("#given a model change #when signing #then the signature changes", () => {
    const before = subagentSignature([flat({ row: row(), depth: 0 })])
    const after = subagentSignature([flat({ row: row({ modelID: null }), depth: 0 })])
    expect(after).not.toBe(before)
  })

  it("#given an active tool change #when signing #then the signature changes", () => {
    const before = subagentSignature([flat({ row: row(), depth: 0 })])
    const after = subagentSignature([flat({ row: row({ activeTool: "read" }), depth: 0 })])
    expect(after).not.toBe(before)
  })

  it("#given a tool call count change #when signing #then the signature changes", () => {
    const before = subagentSignature([flat({ row: row(), depth: 0 })])
    const after = subagentSignature([flat({ row: row({ toolCalls: 3 }), depth: 0 })])
    expect(after).not.toBe(before)
  })

  it("#given a preview change #when signing #then the signature changes", () => {
    const before = subagentSignature([flat({ row: row(), depth: 0 })])
    const after = subagentSignature([flat({ row: row({ promptPreview: "Other task" }), depth: 0 })])
    expect(after).not.toBe(before)
  })

  it("#given a new row #when signing #then the signature changes", () => {
    const before = subagentSignature([flat({ row: row(), depth: 0 })])
    const after = subagentSignature([
      flat({ row: row(), depth: 0 }),
      flat({ row: row({ id: "row-2", agent: "librarian" }), depth: 1 }),
    ])
    expect(after).not.toBe(before)
  })
})

describe("focusIndexPreservingId", () => {
  const cards = [{ id: "a" }, { id: "b" }, { id: "c" }]

  it("#given the focused card still visible #when reseating #then it keeps that card", () => {
    expect(focusIndexPreservingId(cards, "c", 0)).toBe(2)
  })

  it("#given the focused card filtered out #when reseating #then it clamps the previous index", () => {
    expect(focusIndexPreservingId([{ id: "a" }], "c", 2)).toBe(0)
  })

  it("#given no previous id #when reseating #then it clamps the previous index", () => {
    expect(focusIndexPreservingId(cards, undefined, 5)).toBe(2)
  })

  it("#given an empty visible set #when reseating #then it returns zero", () => {
    expect(focusIndexPreservingId([], "a", 1)).toBe(0)
  })
})
