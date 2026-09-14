import { describe, expect, it } from "bun:test"

import { buildSubagentTree, flattenSubagentTree } from "./build-subagent-tree"
import type { SubagentRow } from "./types"

function row(input: {
  id: string
  parentId?: string | null
  agent?: string
  modelID?: string | null
  taskLabel?: string
  promptPreview?: string | null
  status?: string
  startedAt?: number | null
  toolCalls?: number | null
  lastTool?: string | null
  activeTool?: string | null
}): SubagentRow {
  return {
    id: input.id,
    parentId: input.parentId ?? null,
    agent: input.agent ?? "explore",
    modelID: input.modelID ?? null,
    taskLabel: input.taskLabel ?? "task",
    promptPreview: input.promptPreview ?? null,
    status: input.status ?? "running",
    startedAt: input.startedAt ?? null,
    toolCalls: input.toolCalls ?? null,
    lastTool: input.lastTool ?? null,
    activeTool: input.activeTool ?? null,
  }
}

describe("buildSubagentTree", () => {
  it("#given a parent with two children #when building #then it returns one root nesting both children in start order", () => {
    // given
    const rows = [
      row({ id: "child-b", parentId: "parent", startedAt: 200 }),
      row({ id: "parent", startedAt: 100 }),
      row({ id: "child-a", parentId: "parent", startedAt: 150 }),
    ]

    // when
    const roots = buildSubagentTree(rows)

    // then
    expect(roots).toHaveLength(1)
    expect(roots[0]?.row.id).toBe("parent")
    expect(roots[0]?.depth).toBe(0)
    expect(roots[0]?.children.map((child) => child.row.id)).toEqual(["child-a", "child-b"])
    expect(roots[0]?.children.every((child) => child.depth === 1)).toBe(true)
  })

  it("#given multiple roots #when building #then it keeps running first and start order stable", () => {
    // given
    const rows = [
      row({ id: "old-running", startedAt: 300 }),
      row({ id: "fresh-running", startedAt: 100 }),
      row({ id: "queued", status: "pending", startedAt: 50 }),
      row({ id: "done", status: "completed", startedAt: 10 }),
    ]

    // when
    const roots = buildSubagentTree(rows)

    // then
    expect(roots.map((root) => root.row.id)).toEqual([
      "fresh-running",
      "old-running",
      "queued",
      "done",
    ])
  })

  it("#given an orphan whose parent is missing #when building #then it becomes a root", () => {
    // given
    const rows = [
      row({ id: "child", parentId: "missing-parent" }),
      row({ id: "root" }),
    ]

    // when
    const roots = buildSubagentTree(rows)

    // then
    expect(roots.map((root) => root.row.id).sort()).toEqual(["child", "root"])
  })

  it("#given a child that sorts before its parent #when building #then it still nests under the parent", () => {
    // given
    const rows = [
      row({ id: "child", parentId: "parent", status: "running", startedAt: 5 }),
      row({ id: "parent", status: "pending", startedAt: 4 }),
    ]

    // when
    const roots = buildSubagentTree(rows)

    // then
    expect(roots.map((root) => root.row.id)).toEqual(["parent"])
    expect(roots[0]?.children.map((child) => child.row.id)).toEqual(["child"])
  })

  it("#given nested rows across levels #when flattening #then it returns preorder with correct depths", () => {
    // given
    const rows = [
      row({ id: "grand", parentId: "parent" }),
      row({ id: "parent" }),
      row({ id: "child", parentId: "parent" }),
    ]

    // when
    const flat = flattenSubagentTree(buildSubagentTree(rows))

    // then
    expect(flat.map((node) => [node.row.id, node.depth])).toEqual([
      ["parent", 0],
      ["grand", 1],
      ["child", 1],
    ])
  })
})
