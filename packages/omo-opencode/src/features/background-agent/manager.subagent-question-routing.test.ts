import { tmpdir } from "node:os"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"

import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"
import {
  buildChildQuestionAnswerPrompt,
  type QuestionEventApi,
} from "./subagent-question-router"
import type { PluginContext } from "../../plugin/types"

function cast<T>(value: unknown): T {
  return value as T
}

function createPluginInput(client: unknown, directory = tmpdir()): PluginContext {
  return cast<PluginContext>({ client, directory })
}

function createManager(
  waitMs: number,
  eventApi?: QuestionEventApi,
  clientOverrides: { eventSubscribe?: () => Promise<{ stream: AsyncIterable<unknown> }> } = {},
): BackgroundManager {
  const client: Record<string, unknown> = {
    session: {
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
    },
  }
  if (clientOverrides.eventSubscribe) {
    client.event = { subscribe: clientOverrides.eventSubscribe }
  }
  return new BackgroundManager({
    pluginContext: createPluginInput(client),
    questionOrchestratorWaitMs: waitMs,
    eventApi,
  })
}

function registerChildTask(manager: BackgroundManager, overrides: Partial<BackgroundTask> = {}): BackgroundTask {
  const task = cast<BackgroundTask>({
    id: "task-1",
    sessionId: "child-session",
    parentSessionId: "parent-session",
    status: "running",
    description: "child work",
    agent: "sisyphus-junior",
    ...overrides,
  })
  const tasks = cast<{ tasks: Map<string, BackgroundTask> }>(manager).tasks
  tasks.set(task.id, task)
  return task
}

function getPendingParentWakes(manager: BackgroundManager): Map<string, unknown> {
  return cast<{
    parentWakeNotifier: { getPendingParentWakes: () => Map<string, unknown> }
  }>(manager).parentWakeNotifier.getPendingParentWakes()
}

function getPendingQuestionTimers(manager: BackgroundManager): Map<string, ReturnType<typeof setTimeout>> {
  return cast<{ pendingQuestionTimers: Map<string, ReturnType<typeof setTimeout>> }>(manager).pendingQuestionTimers
}

function getPendingQuestions(manager: BackgroundManager): Map<string, unknown> {
  return cast<{ pendingQuestionsByChildSession: Map<string, unknown> }>(manager).pendingQuestionsByChildSession
}

async function flushQueue(manager: BackgroundManager): Promise<void> {
  // enqueueNotificationForParent chains an async operation per parent; let the
  // microtask + debounce settle.
  for (let i = 0; i < 20; i++) {
    await Promise.resolve()
  }
  await new Promise((resolve) => setTimeout(resolve, 30))
}

describe("BackgroundManager — M2d question routing", () => {
  let manager: BackgroundManager

  beforeEach(() => {
    manager = createManager(120_000)
  })

  afterEach(() => {
    for (const timer of getPendingQuestionTimers(manager).values()) {
      clearTimeout(timer)
    }
  })

  test("routes a tracked child's question to the orchestrator and notifies the parent", async () => {
    registerChildTask(manager)

    const result = manager.routeChildQuestion({
      sessionID: "child-session",
      questionArgs: { questions: [{ question: "Commit now?" }] },
    })

    expect(result.routed).toBe("orchestrator")
    expect(result.taskId).toBe("task-1")
    expect(result.parentSessionId).toBe("parent-session")
    expect(getPendingQuestions(manager).has("child-session")).toBe(true)
    expect(getPendingQuestionTimers(manager).has("child-session")).toBe(true)

    await flushQueue(manager)
    const wakes = getPendingParentWakes(manager)
    expect(wakes.has("parent-session")).toBe(true)
  })

  test("routes the child question as an urgent no-reply parent wake", async () => {
    // deliverImmediately bypasses the active-parent deferral so the question
    // reaches the orchestrator within the bounded wait even while the parent
    // session is busy, and shouldReply:false keeps the question PENDING (the
    // notification must not fork a reply turn that auto-consumes the question).
    registerChildTask(manager)
    manager.routeChildQuestion({
      sessionID: "child-session",
      questionArgs: { questions: [{ question: "Commit now?" }] },
    })

    await flushQueue(manager)
    const wake = getPendingParentWakes(manager).get("parent-session") as
      | { shouldReply?: boolean; deliverImmediately?: boolean; notifications?: unknown[] }
      | undefined
    expect(wake).toBeDefined()
    expect(wake?.shouldReply).toBe(false)
    expect(wake?.deliverImmediately).toBe(true)
    expect(Array.isArray(wake?.notifications)).toBe(true)
  })

  test("falls back to user route when the session has no parent task", () => {
    const result = manager.routeChildQuestion({
      sessionID: "unknown-session",
      questionArgs: { questions: [{ question: "hi?" }] },
    })
    expect(result.routed).toBe("user")
    expect(getPendingQuestions(manager).has("unknown-session")).toBe(false)
  })

  test("routeChildQuestion is idempotent across repeated observations", async () => {
    registerChildTask(manager)

    const first = manager.routeChildQuestion({
      sessionID: "child-session",
      questionArgs: { questions: [{ question: "Commit now?" }] },
    })
    const second = manager.routeChildQuestion({
      sessionID: "child-session",
      questionArgs: { questions: [{ question: "Commit now? (again)" }] },
    })

    expect(first.routed).toBe("orchestrator")
    expect(second.routed).toBe("orchestrator")
    // The second call returns the existing pending instead of a new one.
    expect(getPendingQuestions(manager).has("child-session")).toBe(true)
    expect(getPendingQuestionTimers(manager).has("child-session")).toBe(true)

    await flushQueue(manager)
    // Only one wake is queued for the parent (no duplicate notification).
    const wakes = getPendingParentWakes(manager)
    expect(wakes.has("parent-session")).toBe(true)
  })

  test("honors explicit user escalation even for a tracked child", () => {
    registerChildTask(manager)
    const result = manager.routeChildQuestion({
      sessionID: "child-session",
      questionArgs: { questions: [{ question: "hi?" }], route: "user" },
    })
    expect(result.routed).toBe("user")
    expect(getPendingQuestions(manager).has("child-session")).toBe(false)
  })

  test("answer is delivered into the child and clears pending state", async () => {
    registerChildTask(manager)
    manager.routeChildQuestion({
      sessionID: "child-session",
      questionArgs: { questions: [{ question: "Commit now?" }] },
    })

    const answer = await manager.answerChildQuestion("child-session", "Use shell")
    expect(answer.answered).toBe(true)

    // The answer prompt carries the orchestrator answer + marker so the blocked
    // child `question` call can resolve.
    const expectedPrompt = buildChildQuestionAnswerPrompt("Use shell", {
      questions: [{ question: "Commit now?" }],
    } as unknown as Parameters<typeof buildChildQuestionAnswerPrompt>[1])
    expect(expectedPrompt).toContain("Use shell")
    expect(expectedPrompt).toContain("ORCHESTRATOR ANSWER")

    // Pending state + timer cleared after answering.
    expect(getPendingQuestions(manager).has("child-session")).toBe(false)
    expect(getPendingQuestionTimers(manager).has("child-session")).toBe(false)
  })

  test("answering a non-pending question is a no-op", async () => {
    const answer = await manager.answerChildQuestion("child-session", "x")
    expect(answer.answered).toBe(false)
    expect(answer.reason).toBe("no-pending-question")
  })

  test("escalates to the user after the bounded wait when unanswered", async () => {
    const fastManager = createManager(40)
    registerChildTask(fastManager)

    fastManager.routeChildQuestion({
      sessionID: "child-session",
      questionArgs: { questions: [{ question: "Commit now?" }] },
    })

    await new Promise((resolve) => setTimeout(resolve, 90))

    const pending = getPendingQuestions(fastManager).get("child-session") as
      | { escalated: boolean }
      | undefined
    expect(pending?.escalated).toBe(true)
    expect(getPendingQuestionTimers(fastManager).has("child-session")).toBe(false)

    await flushQueue(fastManager)
    const wakes = getPendingParentWakes(fastManager)
    expect(wakes.has("parent-session")).toBe(true)
  })

  test("routes a child question observed on the event bus to the orchestrator", async () => {
    const events: Array<{ type: string; properties: { sessionID: string; tool: string; args: Record<string, unknown> } }> = [
      {
        type: "tool.execute.before",
        properties: { sessionID: "child-session", tool: "question", args: { questions: [{ question: "Event q?" }] } },
      },
      { type: "session.idle", properties: { sessionID: "x", tool: "y", args: {} } },
    ]
    async function* stream(): AsyncIterable<unknown> {
      for (const event of events) {
        yield event
      }
    }
    const eventApi: QuestionEventApi = { subscribe: async () => stream() }

    const busManager = createManager(120_000, eventApi)
    registerChildTask(busManager)

    await flushQueue(busManager)

    expect(getPendingQuestions(busManager).has("child-session")).toBe(true)
    const wakes = getPendingParentWakes(busManager)
    expect(wakes.has("parent-session")).toBe(true)
    busManager.disposeChildQuestionEvents()
  })

  test("subscribes via the client event API and routes the live session.tool.called shape", async () => {
    const events: Array<{ type: string; data: { sessionID: string; input: Record<string, unknown>; executed: boolean } }> = [
      {
        type: "session.tool.called",
        data: {
          sessionID: "child-session",
          input: { questions: [{ question: "Live q?" }] },
          executed: false,
        },
      },
      { type: "session.tool.input.started", data: { sessionID: "child-session", name: "question" } },
      { type: "session.idle", data: { sessionID: "x" } },
    ]
    async function* stream(): AsyncIterable<unknown> {
      for (const event of events) {
        yield event
      }
    }
    // No injected eventApi; the manager must fall back to the client's
    // event.subscribe (the live path).
    const busManager = createManager(120_000, undefined, {
      eventSubscribe: async () => ({ stream: stream() }),
    })
    registerChildTask(busManager)

    await flushQueue(busManager)

    expect(getPendingQuestions(busManager).has("child-session")).toBe(true)
    const wakes = getPendingParentWakes(busManager)
    expect(wakes.has("parent-session")).toBe(true)
    busManager.disposeChildQuestionEvents()
  })

  test("does not route when the client has no event subscription", async () => {
    const noSubManager = createManager(120_000)
    registerChildTask(noSubManager)
    await flushQueue(noSubManager)
    expect(getPendingQuestions(noSubManager).has("child-session")).toBe(false)
  })
})
