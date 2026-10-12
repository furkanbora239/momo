import { describe, expect, it } from "bun:test"
import { createHarness } from "./engine.test-support"

async function startWorker(harness: ReturnType<typeof createHarness>, callerSessionID = "root") {
  return harness.engine.create({ prompt: "Execute task", callerSessionID })
}

describe("native task lifecycle", () => {
  it("ignores duplicate and late V2 events after persisting the first terminal result", async () => {
    const harness = createHarness()
    const task = await startWorker(harness)
    const event = { id: "done-1", type: "execution.succeeded" as const, sessionID: task.sessionID ?? "", result: "completed" }

    await harness.engine.onEvent(event)
    await harness.engine.onEvent(event)
    await harness.engine.onEvent({ id: "late-progress", type: "progress", sessionID: event.sessionID, message: "too late" })

    expect((await harness.repository.get(task.id))?.result).toBe("completed")
    expect(harness.runtime.deliveries.filter((item) => item.taskID === task.id)).toHaveLength(1)
  })

  it("persists only actual session usage with the terminal task outcome", async () => {
    const harness = createHarness()
    const task = await startWorker(harness)
    harness.runtime.inspect = async () => ({ state: "succeeded", result: "done", usage: { inputTokens: 62, outputTokens: 18, scope: "session_cumulative" } })

    await harness.engine.onEvent({ id: "usage-done", type: "execution.succeeded", sessionID: task.sessionID ?? "", result: "done" })

    const persisted = await harness.repository.get(task.id)
    expect(persisted?.usage).toEqual({ inputTokens: 62, outputTokens: 18, scope: "session_cumulative" })
    expect(persisted?.outcomeStatus).toBe("recorded")
  })

  it("interrupts a cancelled running task and cascades cancellation through its children", async () => {
    const harness = createHarness()
    harness.router.routeResult = () => ({ kind: "selected", decisionId: "department", role: "planner", model: { providerID: "test", id: "planner-model" } })
    const department = await startWorker(harness)
    harness.router.routeResult = () => ({ kind: "selected", decisionId: "child", role: "worker", model: { providerID: "test", id: "worker-model" } })
    const child = await harness.engine.create({ prompt: "do the work", callerSessionID: department.sessionID ?? "" })

    const cancelled = await harness.engine.cancel(department.id, "root")

    expect(cancelled.state).toBe("cancelled")
    expect(harness.runtime.interrupts).toContain(department.sessionID)
    expect(harness.runtime.interrupts).toContain(child.sessionID)
    expect((await harness.repository.get(child.id))?.state).toBe("cancelled")
    expect(harness.runtime.deliveries.some((item) => item.taskID === department.id)).toBe(true)
  })

  it("protects active tools, escalates timed out questions, and interrupts only silent sessions", async () => {
    const harness = createHarness({ silenceTimeoutMs: 10, questionTimeoutMs: 10, activeToolTimeoutMs: 3_600_000 })
    const working = await startWorker(harness)
    const questionTask = await startWorker(harness)
    await harness.engine.onEvent({ id: "tool-start", type: "tool.started", sessionID: working.sessionID ?? "", toolID: "tool-1", toolName: "bash" })
    await harness.engine.onEvent({ id: "question", type: "question.asked", sessionID: questionTask.sessionID ?? "", question: { id: "q1", prompt: "Choose", form: { fields: ["x"] } } })
    harness.advance(11)

    expect(await harness.engine.checkWatchdogs()).toEqual([`${questionTask.id}:question`])
    expect(harness.runtime.interrupts).not.toContain(working.sessionID)
    harness.advance(3_600_000 - 11)
    expect(await harness.engine.checkWatchdogs()).toEqual([working.id])
    expect((await harness.repository.get(working.id))?.error).toBe("Task exceeded the active tool timeout.")
    expect(harness.runtime.interrupts).toContain(working.sessionID)
    expect(harness.runtime.escalations).toEqual(["q1"])
    expect((await harness.repository.get(questionTask.id))?.state).toBe("waiting_question")
    await harness.engine.onEvent({ id: "tool-finish", type: "tool.finished", sessionID: working.sessionID ?? "", toolID: "tool-1" })
  })

  it("retries a durably pending root escalation after the V2 notification fails", async () => {
    const harness = createHarness({ questionTimeoutMs: 10 })
    const task = await startWorker(harness)
    await harness.engine.onEvent({ id: "ask-escalation", type: "question.asked", sessionID: task.sessionID ?? "", question: { id: "q-escalate", prompt: "Approve?" } })
    let failure = true
    harness.runtime.escalationAction = async () => {
      if (failure) { failure = false; throw new Error("root inbox unavailable") }
    }
    harness.advance(11)

    await harness.engine.checkWatchdogs()

    expect((await harness.repository.get(task.id))?.questionEscalationStatus).toBe("pending")
    await harness.engine.reconcile()
    expect((await harness.repository.get(task.id))?.questionEscalationStatus).toBe("sent")
    expect(harness.runtime.escalations).toEqual(["q-escalate", "q-escalate"])
  })

  it("keeps a failed answer durable and retries the original form answer after restart", async () => {
    const harness = createHarness()
    const task = await startWorker(harness)
    await harness.engine.onEvent({ id: "ask", type: "question.asked", sessionID: task.sessionID ?? "", question: { id: "q-form", prompt: "Fields", form: { project: "name", approved: false } } })
    let failures = 1
    harness.runtime.answerAction = async () => {
      if (failures-- > 0) throw new Error("temporary answer failure")
    }

    const answered = await harness.engine.answer(task.id, "root", "q-form", { project: "momo", approved: true })
    expect(answered.answerStatus).toBe("pending")
    await harness.engine.reconcile()

    expect((await harness.repository.get(task.id))?.answerStatus).toBe("sent")
    expect(harness.runtime.answers).toHaveLength(2)
    expect(harness.runtime.answers[1]?.answer).toEqual({ project: "momo", approved: true })
  })

  it("retries parent delivery without rerunning completed work", async () => {
    const harness = createHarness()
    const task = await startWorker(harness)
    let failures = 1
    harness.runtime.deliverAction = async () => {
      if (failures-- > 0) throw new Error("parent temporarily unavailable")
    }
    await harness.engine.onEvent({ id: "complete", type: "execution.succeeded", sessionID: task.sessionID ?? "", result: "done" })
    expect((await harness.repository.get(task.id))?.delivery?.status).toBe("pending")

    await harness.engine.reconcile()

    expect((await harness.repository.get(task.id))?.delivery?.status).toBe("delivered")
    expect(harness.runtime.starts).toHaveLength(1)
    expect(harness.runtime.deliveries).toHaveLength(2)
  })

  it("reconciles a live V2 session without resending its prompt and never reruns a succeeded task", async () => {
    const harness = createHarness()
    const task = await startWorker(harness)
    let live = true
    harness.runtime.inspect = async () => live ? { state: "running" } : { state: "succeeded", result: "inspected result" }

    await harness.engine.reconcile()
    expect(harness.runtime.resumes).toHaveLength(0)
    live = false
    await harness.engine.reconcile()
    await harness.engine.reconcile()

    expect(await harness.repository.get(task.id)).toMatchObject({ state: "succeeded", result: "inspected result", delivery: { status: "delivered" } })
    expect(harness.runtime.starts).toHaveLength(1)
    expect(harness.runtime.resumes).toHaveLength(0)
  })

  it("holds a completed department in waiting_children until its active worker finishes", async () => {
    const harness = createHarness()
    const parent = await startWorker(harness)
    harness.router.routeResult = () => ({ kind: "selected", decisionId: "dept", role: "planner", model: { providerID: "p", id: "planner" } })
    const department = await harness.engine.create({ prompt: "Coordinate children", callerSessionID: "root" })
    harness.router.routeResult = () => ({ kind: "selected", decisionId: "worker", role: "worker", model: { providerID: "p", id: "worker" } })
    const child = await harness.engine.create({ prompt: "Execute", callerSessionID: department.sessionID ?? "" })
    harness.runtime.inspect = async (sessionID) => sessionID === department.sessionID
      ? { state: "succeeded", result: "department summary" }
      : { state: "running" }

    await harness.engine.reconcile()

    expect((await harness.repository.get(department.id))?.state).toBe("waiting_children")
    await harness.engine.onEvent({ id: "child-finished", type: "execution.succeeded", sessionID: child.sessionID ?? "", result: "work done" })
    expect(await harness.repository.get(department.id)).toMatchObject({ state: "running", executionOutcome: undefined })
    expect(harness.runtime.parentContinuations.some((message) => message.includes("work done"))).toBe(true)
    await harness.engine.onEvent({ id: "department-finished-after-children", type: "execution.succeeded", sessionID: department.sessionID ?? "", result: "combined result" })
    expect(await harness.repository.get(department.id)).toMatchObject({ state: "succeeded", result: "combined result" })
    expect(harness.runtime.deliveries.some((delivery) => delivery.taskID === department.id && delivery.result === "combined result")).toBe(true)
    expect((await harness.repository.get(parent.id))?.state).toBe("running")
  })

  it("yields a same-model generation slot while a department waits for a child and reacquires without a duplicate prompt", async () => {
    const harness = createHarness({ defaultConcurrency: 1 })
    harness.router.routeResult = () => ({ kind: "selected", decisionId: "department", role: "planner", model: { providerID: "test", id: "shared-model" } })
    const department = await startWorker(harness)
    harness.router.routeResult = () => ({ kind: "selected", decisionId: "child", role: "worker", model: { providerID: "test", id: "shared-model" } })
    const child = await harness.engine.create({ prompt: "Execute", callerSessionID: department.sessionID ?? "" })
    expect(child.state).toBe("queued")

    const waiting = harness.engine.wait(child.id, department.sessionID ?? "", 2_000)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect((await harness.repository.get(child.id))?.state).toBe("running")
    expect((await harness.repository.get(department.id))?.state).toBe("waiting_children")
    const startedChild = await harness.repository.get(child.id)
    await harness.engine.onEvent({ id: "same-model-child-done", type: "execution.succeeded", sessionID: startedChild?.sessionID ?? "", result: "consultation complete" })

    const result = await waiting
    expect(result.state).toBe("succeeded")
    expect((await harness.repository.get(department.id))?.state).toBe("running")
    expect(harness.runtime.resumes.some((entry) => entry.taskID === department.id)).toBe(false)
    expect(harness.runtime.starts.filter((entry) => entry.taskID === department.id)).toHaveLength(1)
  })

  it("allows advice selection only after router revalidation and scopes control methods to the root", async () => {
    const harness = createHarness()
    harness.router.routeResult = () => ({ kind: "awaiting_selection", decisionId: "choose", reason: "Pick model", candidates: [{ role: "worker", model: { providerID: "p", id: "m" } }] })
    const task = await startWorker(harness)
    await expect(harness.engine.select(task.id, "other-session", { providerID: "p", id: "m" }, "worker")).rejects.toThrow("access is limited")
    harness.router.selectionResult = () => ({ kind: "awaiting_selection", decisionId: "choose-2", reason: "Candidate went stale", candidates: [{ role: "worker", model: { providerID: "p", id: "m2" } }] })
    const refreshed = await harness.engine.select(task.id, "root", { providerID: "p", id: "m" }, "worker")
    expect(refreshed.state).toBe("awaiting_selection")
    harness.router.selectionResult = (_id, model, role) => ({ kind: "selected", decisionId: "choose-2", model, role })
    const selected = await harness.engine.select(task.id, "root", { providerID: "p", id: "m2" }, "worker")
    expect(selected.state).toBe("running")
    await expect(harness.engine.cancel(task.id, "unrelated")).rejects.toThrow("access is limited")
  })

  it("does not silently change the recorded model when an existing session cannot resume its assignment", async () => {
    const harness = createHarness()
    const task = await startWorker(harness)
    harness.router.revalidateSelected = async () => ({
      kind: "selected",
      decisionId: "new-decision",
      role: "worker",
      model: { providerID: "other-provider", id: "replacement" },
    })

    const resumed = await harness.engine.resume(task.id, "root")

    expect(resumed).toMatchObject({ state: "interrupted", sessionID: task.sessionID, model: task.model })
    expect(harness.runtime.starts).toHaveLength(1)
  })
})
