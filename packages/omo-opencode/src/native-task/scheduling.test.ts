import { describe, expect, it } from "bun:test"
import { createHarness, createDepartment, workerRoute } from "./engine.test-support"

describe("native task scheduling", () => {
  it("persists the running state before starting a V2 child session", async () => {
    const harness = createHarness()
    harness.router.routeResult = workerRoute
    harness.runtime.start = async (input) => {
      const taskID = input.sessionID.replace("session-", "")
      const persisted = await harness.repository.get(taskID)
      expect(persisted?.state).toBe("running")
      expect(persisted?.sessionID).toBe(input.sessionID)
      const entry = harness.runtime.starts.find((candidate) => candidate.taskID === taskID)
      if (entry !== undefined) entry.prompt = input.prompt
    }

    const task = await harness.engine.create({ prompt: "Do work", callerSessionID: "root" })

    expect(task.state).toBe("running")
    expect(harness.runtime.starts).toHaveLength(1)
  })

  it("persists task identity before awaiting the route decision", async () => {
    const harness = createHarness()
    let enteredRoute: (() => void) | undefined
    let releaseRoute: ((result: ReturnType<typeof workerRoute>) => void) | undefined
    const routeEntered = new Promise<void>((resolve) => { enteredRoute = resolve })
    const routeGate = new Promise<ReturnType<typeof workerRoute>>((resolve) => { releaseRoute = resolve })
    harness.router.routeResult = async () => {
      enteredRoute?.()
      return routeGate
    }

    const creating = harness.engine.create({ prompt: "Durable before routing", callerSessionID: "root" })
    await routeEntered
    const pending = await harness.repository.list()
    expect(pending).toMatchObject([{ prompt: "Durable before routing", routeStatus: "pending", state: "queued" }])
    expect(harness.router.routeInputs[0]?.decisionId).toBe(pending[0]?.id)
    releaseRoute?.(workerRoute())
    await expect(creating).resolves.toMatchObject({ state: "running" })
  })

  it("runs five child sessions in parallel and leaves the sixth queued until capacity frees", async () => {
    const harness = createHarness({ maxConcurrent: 5 })
    const parent = await createDepartment(harness)
    harness.router.routeResult = workerRoute
    const createChild = (index: number) => harness.engine.create({
      prompt: `Child ${index}`,
      callerSessionID: parent.sessionID ?? "",
    })

    const children = await Promise.all(Array.from({ length: 6 }, (_, index) => createChild(index)))

    expect(children.filter((task) => task.state === "running")).toHaveLength(4)
    expect(children.filter((task) => task.state === "queued")).toHaveLength(2)
    expect((await harness.engine.status(parent.id, "root-session")).state).toBe("running")
    await harness.engine.onEvent({ id: "parent-waits", type: "children.waiting", sessionID: parent.sessionID ?? "" })
    const afterYield = await harness.repository.list()
    expect(afterYield.filter((task) => task.parentTaskID === parent.id && task.state === "running")).toHaveLength(5)
    expect(afterYield.filter((task) => task.parentTaskID === parent.id && task.state === "queued")).toHaveLength(1)
    const first = children.find((task) => task.state === "running")
    if (!first?.sessionID) throw new Error("Expected a started child session")
    await harness.engine.onEvent({ id: "child-done", type: "execution.succeeded", sessionID: first.sessionID, result: "done" })

    expect((await harness.repository.list()).filter((task) => task.parentTaskID === parent.id && task.state === "running")).toHaveLength(5)
    expect(harness.runtime.starts).toHaveLength(7)
  })

  it("rejects worker spawning and enforces department-to-single-agent escalation rules", async () => {
    const harness = createHarness()
    harness.router.routeResult = workerRoute
    harness.runtime.callers.set("worker-session", { role: "worker", rootSessionID: "worker-session" })
    await expect(harness.engine.create({ prompt: "spawn", callerSessionID: "worker-session" })).rejects.toThrow("cannot create child tasks")
    const parent = await createDepartment(harness)
    harness.router.routeResult = () => ({ kind: "selected", decisionId: "bad", role: "reviewer", model: { providerID: "test", id: "expensive" } })

    const rejected = await harness.engine.create({ prompt: "make a department", callerSessionID: parent.sessionID ?? "" })

    expect(rejected.state).toBe("failed")
    expect(harness.runtime.starts).toHaveLength(1)
  })

  it("skips a queued model whose provider is full so another provider can use capacity", async () => {
    const harness = createHarness({ maxConcurrent: 2, providerConcurrency: { alpha: 1 } })
    harness.router.routeResult = (input) => ({
      kind: "selected",
      decisionId: input.prompt,
      role: "worker",
      model: { providerID: input.prompt === "other provider" ? "beta" : "alpha", id: "model" },
    })
    const first = await harness.engine.create({ prompt: "alpha one", callerSessionID: "root" })
    const blocked = await harness.engine.create({ prompt: "alpha two", callerSessionID: "root" })
    const other = await harness.engine.create({ prompt: "other provider", callerSessionID: "root" })

    expect(first.state).toBe("running")
    expect(blocked.state).toBe("queued")
    expect(other.state).toBe("running")
  })

  it("applies the default limit per model and preserves zero as unlimited", async () => {
    const harness = createHarness()
    harness.router.routeResult = (input) => ({
      kind: "selected",
      decisionId: input.prompt,
      role: "worker",
      model: { providerID: "provider", id: input.prompt.startsWith("first") ? "first-model" : "second-model" },
    })
    const tasks = await Promise.all(Array.from({ length: 12 }, (_, index) => harness.engine.create({
      prompt: index < 6 ? `first ${index}` : `second ${index}`,
      callerSessionID: "root",
    })))

    expect(tasks.filter((task) => task.state === "running")).toHaveLength(10)
    expect(tasks.filter((task) => task.state === "queued")).toHaveLength(2)

    const unlimited = createHarness({ modelConcurrency: { "provider/first-model": 0 } })
    unlimited.router.routeResult = (input) => ({
      kind: "selected",
      decisionId: input.prompt,
      role: "worker",
      model: { providerID: "provider", id: "first-model" },
    })
    const unlimitedTasks = await Promise.all(Array.from({ length: 8 }, (_, index) => unlimited.engine.create({
      prompt: `first ${index}`,
      callerSessionID: "root",
    })))
    expect(unlimitedTasks.every((task) => task.state === "running")).toBe(true)
  })

  it("revalidates a selected route before allocating a V2 session", async () => {
    const harness = createHarness()
    harness.router.revalidateSelected = async () => ({
      kind: "awaiting_selection",
      decisionId: "refreshed",
      reason: "Selected model is no longer available",
      candidates: [{ role: "worker", model: { providerID: "p", id: "replacement" } }],
    })

    const task = await harness.engine.create({ prompt: "Check live availability", callerSessionID: "root" })

    expect(task).toMatchObject({ state: "awaiting_selection", decisionId: "refreshed" })
    expect(harness.runtime.starts).toHaveLength(0)
  })
})
