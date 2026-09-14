import { describe, expect, it } from "bun:test"

import { collectSubagentRows } from "./collect-subagent-rows"
import type { BackgroundTaskSnapshot } from "../background-agent/types"
import type { TrackedTask } from "../task-toast-manager/types"

function bgTask(input: Partial<BackgroundTaskSnapshot> = {}): BackgroundTaskSnapshot {
  return {
    title: "Index repository",
    status: "running",
    toolCalls: null,
    lastTool: null,
    agent: "explore",
    ...input,
  }
}

function trackedTask(input: Partial<TrackedTask> = {}): TrackedTask {
  return {
    id: "task-1",
    description: "Run unit tests",
    agent: "worker",
    status: "running",
    startedAt: new Date("2026-09-14T10:00:00.000Z"),
    isBackground: false,
    ...input,
  }
}

describe("collectSubagentRows", () => {
  it("#given no providers #when collecting #then it returns no rows", () => {
    // given

    // when
    const rows = collectSubagentRows({})

    // then
    expect(rows).toEqual([])
  })

  it("#given a background snapshot #when collecting #then it carries session parent model and task label", () => {
    // given
    const rows = collectSubagentRows({
      backgroundManager: {
        getTasksSnapshot: () => [
          bgTask({
            sessionId: "ses-child",
            parentSessionId: "ses-parent",
            modelID: "google/gemini-2.5-flash",
            promptPreview: "Map every caller",
            startedAt: 100,
          }),
        ],
      },
    })

    // when
    const [first] = rows

    // then
    expect(first?.id).toBe("ses-child")
    expect(first?.parentId).toBe("ses-parent")
    expect(first?.modelID).toBe("google/gemini-2.5-flash")
    expect(first?.promptPreview).toBe("Map every caller")
    expect(first?.taskLabel).toBe("Index repository")
  })

  it("#given a tracked toast task #when collecting #then it uses the description as the task label", () => {
    // given
    const rows = collectSubagentRows({
      toastManager: {
        getRunningTasks: () => [trackedTask()],
      },
    })

    // when
    const [first] = rows

    // then
    expect(first?.taskLabel).toBe("Run unit tests")
    expect(first?.promptPreview).toBeNull()
    expect(first?.modelID).toBeNull()
    expect(first?.parentId).toBeNull()
  })

  it("#given the same session in both providers #when collecting #then it merges into one row", () => {
    // given
    const rows = collectSubagentRows({
      backgroundManager: {
        getTasksSnapshot: () => [
          bgTask({
            sessionId: "ses-shared",
            parentSessionId: "ses-parent",
            title: "Background view",
          }),
        ],
      },
      toastManager: {
        getRunningTasks: () => [
          trackedTask({
            sessionID: "ses-shared",
            description: "Toast view",
            modelInfo: { model: "openai/gpt-5.6-flash", type: "category-default" },
            activeTool: "grep",
          }),
        ],
      },
    })

    // when
    const shared = rows.filter((row) => row.id === "ses-shared")

    // then
    expect(shared).toHaveLength(1)
    expect(shared[0]?.modelID).toBe("openai/gpt-5.6-flash")
    expect(shared[0]?.activeTool).toBe("grep")
    expect(shared[0]?.parentId).toBe("ses-parent")
  })

  it("#given queued toast tasks #when collecting #then they appear with the queued status", () => {
    // given
    const rows = collectSubagentRows({
      toastManager: {
        getRunningTasks: () => [],
        getQueuedTasks: () => [trackedTask({ id: "task-queued", status: "queued" })],
      },
    })

    // when
    const queued = rows.find((row) => row.id === "task:task-queued")

    // then
    expect(queued?.status).toBe("queued")
  })
})
