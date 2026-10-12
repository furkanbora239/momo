import { createNativeTaskEngine } from "./engine"
import { FakeNativeTaskRouter, FakeNativeTaskRuntime, MemoryNativeTaskRepository } from "./testing"

export function createHarness(options: {
  maxConcurrent?: number
  defaultConcurrency?: number
  providerConcurrency?: number | Readonly<Record<string, number>>
  modelConcurrency?: number | Readonly<Record<string, number>>
  silenceTimeoutMs?: number
  activeToolTimeoutMs?: number
} = {}) {
  let clock = 1_000
  const repository = new MemoryNativeTaskRepository()
  const router = new FakeNativeTaskRouter()
  const runtime = new FakeNativeTaskRuntime()
  const engine = createNativeTaskEngine({
    repository,
    router,
    runtime,
    ...options,
    now: () => clock,
  })
  return { engine, repository, router, runtime, advance: (duration: number) => { clock += duration } }
}

export async function createDepartment(harness: ReturnType<typeof createHarness>) {
  harness.router.routeResult = () => ({
    kind: "selected",
    decisionId: "root-decision",
    role: "planner",
    model: { providerID: "test", id: "planner-model" },
  })
  const task = await harness.engine.create({
    prompt: "Plan this task",
    callerSessionID: "root-session",
  })
  return await harness.engine.status(task.id, "root-session")
}

export function workerRoute() {
  return {
    kind: "selected" as const,
    decisionId: "worker-decision",
    role: "worker" as const,
    model: { providerID: "test", id: "worker-model" },
  }
}
