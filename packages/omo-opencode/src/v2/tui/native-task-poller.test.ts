import { describe, expect, it } from "bun:test"
import { createNativeTaskPoller } from "./native-task-poller"
import { nativeTaskViewText, readNativeTaskRows, type NativeTaskView } from "./native-task-view"

const task = (rootSessionID = "root") => ({ id: "task-1", rootSessionID, role: "worker", state: "running", model: { providerID: "provider", id: "actual/model-with-full-name" }, prompt: "Inspect source" })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("native task display", () => {
  it("shows assigned models and exact waiting/terminal states, never candidates", () => {
    for (const state of ["queued", "running", "waiting_question", "waiting_children", "succeeded", "failed", "cancelled", "interrupted"]) {
      const rows = readNativeTaskRows({ tasks: [{ ...task(), state }] }, "root")
      expect(rows[0]?.model).toBe("provider/actual/model-with-full-name")
      expect(rows[0]?.state).toBe(state)
    }
    const rows = readNativeTaskRows({ tasks: [{ ...task(), state: "awaiting_selection", candidates: [{ model: { providerID: "premium", id: "candidate" } }] }] }, "root")
    expect(rows[0]?.model).toBe("unassigned")
    expect(nativeTaskViewText({ status: "ready", rows })).not.toContain("premium")
  })
  it("puts current work before completed history, newest first in each group", () => {
    const tasks = Array.from({ length: 30 }, (_, index) => ({ ...task(), id: `old-${index}`, state: "succeeded", updatedAt: index }))
    const rows = readNativeTaskRows({ tasks: [...tasks, { ...task(), id: "running", updatedAt: 50 }, { ...task(), id: "question", state: "waiting_question", updatedAt: 55 }] }, "root")
    expect(rows.slice(0, 3).map((row) => row.id)).toEqual(["question", "running", "old-29"])
    expect(rows).toHaveLength(32)
  })
  it("rejects other lineages and distinguishes no tasks from unavailable", () => {
    expect(() => readNativeTaskRows({ tasks: [task("other")] }, "root")).toThrow()
    expect(() => readNativeTaskRows({ tasks: [{}] }, "root")).toThrow()
    expect(nativeTaskViewText({ status: "ready", rows: [] })).toContain("No momo tasks")
    expect(nativeTaskViewText({ status: "unavailable", rows: [] })).not.toContain("No momo tasks")
  })
})

describe("native mounted poller", () => {
  it("aborts old scope requests, drops late responses, and stops after disposal", async () => {
    const requests: { root: string; signal: AbortSignal; resolve: (value: unknown) => void }[] = []
    const updates: NativeTaskView[] = []
    const poller = createNativeTaskPoller({
      read: (root, signal) => new Promise((resolve) => requests.push({ root, signal, resolve })),
      update: (view) => updates.push(view), intervalMs: 10,
    })
    poller.setScope("root")
    poller.setScope("other")
    expect(requests[0]?.signal.aborted).toBe(true)
    requests[0]?.resolve({ tasks: [task()] })
    requests[1]?.resolve({ tasks: [task("other")] })
    await settle()
    expect(updates.at(-1)?.status).toBe("ready")
    expect(updates.filter((view) => view.status === "ready")).toHaveLength(1)
    poller.dispose()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(requests).toHaveLength(2)
  })
  it("keeps prior rows explicitly stale on failure then recovers", async () => {
    let calls = 0
    const updates: NativeTaskView[] = []
    const poller = createNativeTaskPoller({
      read: async () => { if (++calls === 2) throw new Error("offline"); return { tasks: [task()] } },
      update: (view) => updates.push(view), intervalMs: 5,
    })
    poller.setScope("root")
    await new Promise((resolve) => setTimeout(resolve, 18))
    poller.dispose()
    expect(updates.some((view) => view.status === "stale" && view.rows.length === 1)).toBe(true)
    expect(updates.at(-1)?.status).toBe("ready")
  })
  it("times out a hung request and aborts on unmount without publishing stale work", async () => {
    const signals: AbortSignal[] = []
    const updates: NativeTaskView[] = []
    const poller = createNativeTaskPoller({ read: async (_, signal) => { signals.push(signal); return new Promise(() => undefined) }, update: (view) => updates.push(view), timeoutMs: 5, intervalMs: 20 })
    poller.setScope("root")
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(signals[0]?.aborted).toBe(true)
    expect(updates.at(-1)?.status).toBe("unavailable")
    poller.setScope("other")
    const count = updates.length
    poller.dispose()
    await settle()
    expect(signals[1]?.aborted).toBe(true)
    expect(updates).toHaveLength(count)
  })
})
