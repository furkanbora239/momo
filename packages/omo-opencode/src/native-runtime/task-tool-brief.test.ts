import { expect, test } from "bun:test"
import type { NativeTask } from "../native-task"
import { taskToolView, nextTaskActions } from "./task-tool-brief"

function task(patch: Partial<NativeTask> = {}): NativeTask {
  return { id: "task", kind: "task", rootTaskID: "task", rootSessionID: "root", parentSessionID: "root", parentRole: "orchestrator", state: "running", prompt: "Work", createdAt: 1, updatedAt: 1, attempts: 1, activeTools: [], childTaskIDs: [], processedEventIDs: [], role: "worker", ...patch }
}

test("brief output preserves interruption reason and offers same-task recovery", () => {
  expect(taskToolView(task({ state: "interrupted", error: "silence timeout" }), "brief")).toMatchObject({ state: "interrupted", error: "silence timeout", nextActions: ["detail", "resume", "cancel"] })
})

test("brief output keeps native question identity and directs parent to complete schema", () => {
  expect(taskToolView(task({ state: "waiting_question", question: { id: "form", prompt: "Missing input?" } }), "brief", "root")).toMatchObject({ question: { id: "form" }, nextActions: ["detail", "answer"] })
})

test("brief monitoring omits repeated result text while full view remains compatible", () => {
  const record = task({ state: "succeeded", result: "x".repeat(1800), model: { providerID: "p", id: "m" } })
  const full = taskToolView(record), brief = taskToolView(record, "brief")
  expect(taskToolView(record, "full")).toEqual(full)
  expect(brief).toMatchObject({ id: "task", resultInfo: { available: true, length: 1800 }, verification: "unknown", nextActions: ["result"] })
  expect(JSON.stringify(brief).length).toBeLessThan(JSON.stringify(full).length / 2)
  expect(nextTaskActions(task({ kind: "consultation", state: "interrupted" }))).not.toContain("resume")
})

test("root guidance respects parent-only selection and question escalation", () => {
  const grandchild = task({ parentSessionID: "department", state: "awaiting_selection" })
  expect(nextTaskActions(grandchild, "root")).toEqual(["candidates"])
  expect(nextTaskActions(grandchild, "department")).toContain("select")
  grandchild.state = "waiting_question"
  expect(nextTaskActions(grandchild, "root")).not.toContain("answer")
  expect(nextTaskActions({ ...grandchild, questionEscalated: true }, "root")).toContain("answer")
})
