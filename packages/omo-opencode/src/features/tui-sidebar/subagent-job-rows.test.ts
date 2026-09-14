import { describe, expect, it } from "bun:test"

import { MIRROR_SCHEMA_VERSION } from "./constants"
import { deriveJobBoard } from "./derivers"
import { computeView } from "./compute-view"
import { describeView } from "./render-view"
import type { TuiRuntimeSnapshot } from "./snapshot-schema"
import type { JobRow } from "./state-types"

function snapshot(jobBoard: readonly JobRow[]): TuiRuntimeSnapshot {
  return {
    version: MIRROR_SCHEMA_VERSION,
    projectDir: "/tmp/project",
    updatedAt: 1,
    activeAgents: [],
    jobBoard: [...jobBoard],
    loop: null,
  }
}

describe("deriveJobBoard with subagent parent fields", () => {
  it("#given a child that sorts before its parent #when deriving #then the parent stays first", () => {
    // given
    const rows: readonly JobRow[] = [
      { title: "child", status: "running", toolCalls: 0, lastTool: null, sessionId: "ses-child", parentSessionId: "ses-parent" },
      { title: "parent", status: "pending", toolCalls: 0, lastTool: null, sessionId: "ses-parent" },
    ]

    // when
    const state = deriveJobBoard(snapshot(rows))

    // then
    expect(state.kind).toBe("list")
    if (state.kind === "list") {
      expect(state.jobs.map((job) => job.title)).toEqual(["parent", "child"])
    }
  })

  it("#given rows without parent fields #when deriving #then the existing status and title order holds", () => {
    // given
    const rows: readonly JobRow[] = [
      { title: "z-run", status: "running", toolCalls: null, lastTool: null },
      { title: "a-run", status: "running", toolCalls: null, lastTool: null },
      { title: "a-pending", status: "pending", toolCalls: null, lastTool: null },
    ]

    // when
    const state = deriveJobBoard(snapshot(rows))

    // then
    expect(state.kind).toBe("list")
    if (state.kind === "list") {
      expect(state.jobs.map((job) => job.title)).toEqual(["a-run", "z-run", "a-pending"])
    }
  })

  it("#given an orphan child #when deriving #then it stays in its sorted position as a root", () => {
    // given
    const rows: readonly JobRow[] = [
      { title: "orphan", status: "running", toolCalls: null, lastTool: null, sessionId: "ses-orphan", parentSessionId: "ses-missing" },
      { title: "root", status: "running", toolCalls: null, lastTool: null },
    ]

    // when
    const state = deriveJobBoard(snapshot(rows))

    // then
    expect(state.kind).toBe("list")
    if (state.kind === "list") {
      expect(state.jobs).toHaveLength(2)
    }
  })
})

describe("describeView with subagent job fields", () => {
  it("#given a job with a parent #when describing #then it indents the child line", () => {
    // given
    const rows: readonly JobRow[] = [
      { title: "parent job", status: "running", toolCalls: 1, lastTool: "read", sessionId: "ses-parent" },
      { title: "child job", status: "running", toolCalls: 2, lastTool: "grep", sessionId: "ses-child", parentSessionId: "ses-parent" },
    ]
    const view = computeView({
      config: { kind: "valid" },
      roster: { kind: "empty" },
      agents: { kind: "none" },
      jobs: deriveJobBoard(snapshot(rows)),
      loop: { kind: "none" },
    })

    // when
    const description = describeView(view)

    // then
    expect(description).toContain("  child job")
    expect(description).not.toContain("  parent job")
  })

  it("#given a job with a model #when describing #then it includes the model label", () => {
    // given
    const rows: readonly JobRow[] = [
      { title: "index", status: "running", toolCalls: 0, lastTool: null, model: "google/gemini-2.5-flash" },
    ]
    const view = computeView({
      config: { kind: "valid" },
      roster: { kind: "empty" },
      agents: { kind: "none" },
      jobs: deriveJobBoard(snapshot(rows)),
      loop: { kind: "none" },
    })

    // when
    const description = describeView(view)

    // then
    expect(description).toContain("google/gemini-2.5-flash")
  })

  it("#given a job with a prompt preview #when describing #then it renders the preview on its own line", () => {
    // given
    const rows: readonly JobRow[] = [
      { title: "index", status: "running", toolCalls: 0, lastTool: null, promptPreview: "Trace every caller of renderSidebar" },
    ]
    const view = computeView({
      config: { kind: "valid" },
      roster: { kind: "empty" },
      agents: { kind: "none" },
      jobs: deriveJobBoard(snapshot(rows)),
      loop: { kind: "none" },
    })

    // when
    const description = describeView(view)

    // then
    expect(description).toContain("Trace every caller of renderSidebar")
  })
})
