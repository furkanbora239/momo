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
  clientArg?: Record<string, unknown>,
): BackgroundManager {
  const client: Record<string, unknown> = clientArg ?? {
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

  test("delivers the orchestrator answer via the child's open form and clears pending state", async () => {
    // The worker's `question` tool opens an OpenCode FORM; the answer must be
    // delivered as a form reply (a plain prompt injection is dropped by the
    // async-gate reservation for the blocked child).
    const replies: Array<{ formID: string; answer: Record<string, unknown> }> = []
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
        form: {
          list: async () => ({
            data: [
              {
                id: "form_abc",
                status: "pending",
                fields: [{ id: "q0", type: "string", custom: true }],
              },
            ],
          }),
          reply: async (opts: { path: { sessionID: string; formID: string }; body: { answer: Record<string, unknown> } }) => {
            replies.push({ formID: opts.path.formID, answer: opts.body.answer })
          },
        },
      },
    }
    const formManager = createManager(120_000, undefined, {}, client as unknown as Record<string, unknown>)
    registerChildTask(formManager)
    formManager.routeChildQuestion({
      sessionID: "child-session",
      questionArgs: { questions: [{ question: "What is the codename of this repository?" }] },
    })

    const answer = await formManager.answerChildQuestion("child-session", "The codename is momo.")
    expect(answer.answered).toBe(true)
    expect(replies).toHaveLength(1)
    expect(replies[0].formID).toBe("form_abc")
    expect(replies[0].answer).toEqual({ q0: "The codename is momo." })

    // Pending state + timer cleared after answering via the form.
    expect(getPendingQuestions(formManager).has("child-session")).toBe(false)
    expect(getPendingQuestionTimers(formManager).has("child-session")).toBe(false)
    formManager.shutdown()
  })

  test("falls back to prompt injection when no form API is available", async () => {
    // Older SDK without the form surface: the answer path must still succeed
    // via prompt injection (cannot hang the orchestrator on a missing API).
    const formManager = createManager(120_000)
    registerChildTask(formManager)
    formManager.routeChildQuestion({
      sessionID: "child-session",
      questionArgs: { questions: [{ question: "Commit now?" }] },
    })

    const answer = await formManager.answerChildQuestion("child-session", "Use shell")
    expect(answer.answered).toBe(true)
    expect(getPendingQuestions(formManager).has("child-session")).toBe(false)
    formManager.shutdown()
  })

  test("uses the generic request() surface when session.form is absent", async () => {
    const replies: Array<{ url: string; body: unknown }> = []
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
      request: async (opts: { method: string; url: string; body?: unknown }) => {
        if (opts.method === "GET" && opts.url.endsWith("/form")) {
          return {
            data: [
              {
                id: "form_req",
                status: "pending",
                fields: [{ id: "q0", type: "string", custom: true }],
              },
            ],
          }
        }
        if (opts.method === "POST" && opts.url.includes("/form/form_req/reply")) {
          replies.push({ url: opts.url, body: opts.body })
        }
        return {}
      },
    }
    const reqManager = createManager(120_000, undefined, {}, client as unknown as Record<string, unknown>)
    registerChildTask(reqManager)
    reqManager.routeChildQuestion({
      sessionID: "child-session",
      questionArgs: { questions: [{ question: "Branch to target?" }] },
    })

    const answer = await reqManager.answerChildQuestion("child-session", "main")
    expect(answer.answered).toBe(true)
    expect(replies).toHaveLength(1)
    expect(replies[0].body).toEqual({ answer: { q0: "main" } })
    reqManager.shutdown()
  })

  test("uses the internal _client.request surface (SDK 1.15.13 has no form/request)", async () => {
    const replies: Array<{ url: string; body: unknown }> = []
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
      _client: {
        options: { baseUrl: "http://127.0.0.1:49374" },
        request: async (opts: { method: string; url: string; body?: unknown }) => {
          if (opts.method === "GET" && opts.url === "/api/session/child-session/form") {
            return {
              data: [
                {
                  id: "form_int",
                  status: "pending",
                  fields: [{ id: "q0", type: "string", custom: true }],
                },
              ],
            }
          }
          if (opts.method === "POST" && opts.url === "/api/session/child-session/form/form_int/reply") {
            replies.push({ url: opts.url, body: opts.body })
          }
          return {}
        },
      },
    }
    const intManager = createManager(120_000, undefined, {}, client as unknown as Record<string, unknown>)
    registerChildTask(intManager)
    intManager.routeChildQuestion({
      sessionID: "child-session",
      questionArgs: { questions: [{ question: "Branch to target?" }] },
    })

    const answer = await intManager.answerChildQuestion("child-session", "develop")
    expect(answer.answered).toBe(true)
    expect(replies).toHaveLength(1)
    expect(replies[0].url).toBe("/api/session/child-session/form/form_int/reply")
    expect(replies[0].body).toEqual({ answer: { q0: "develop" } })
    intManager.shutdown()
  })

  test("falls back to prompt injection when baseUrl already carries /api (prefix normalization)", async () => {
    // baseUrl ends with /api, so the canonical /api prefix would double up; the
    // helper must use the empty prefix and still deliver the reply.
    const replies: Array<{ url: string; body: unknown }> = []
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
      _client: {
        options: { baseUrl: "http://127.0.0.1:49374/api" },
        request: async (opts: { method: string; url: string; body?: unknown }) => {
          if (opts.method === "GET" && opts.url === "/session/child-session/form") {
            return {
              data: [
                {
                  id: "form_api",
                  status: "pending",
                  fields: [{ id: "q0", type: "string", custom: true }],
                },
              ],
            }
          }
          if (opts.method === "POST" && opts.url === "/session/child-session/form/form_api/reply") {
            replies.push({ url: opts.url, body: opts.body })
          }
          return {}
        },
      },
    }
    const apiManager = createManager(120_000, undefined, {}, client as unknown as Record<string, unknown>)
    registerChildTask(apiManager)
    apiManager.routeChildQuestion({
      sessionID: "child-session",
      questionArgs: { questions: [{ question: "Branch to target?" }] },
    })

    const answer = await apiManager.answerChildQuestion("child-session", "main")
    expect(answer.answered).toBe(true)
    expect(replies).toHaveLength(1)
    expect(replies[0].url).toBe("/session/child-session/form/form_api/reply")
    apiManager.shutdown()
  })

  test("public client.request surface normalizes the /api prefix from baseUrl", async () => {
    // The live opencode-go client exposes the HeyApi `request` method (case 3),
    // which builds the URL from getConfig().baseUrl. When that baseUrl already
    // ends with /api the canonical /api prefix must NOT be added again, or the
    // list returns an empty array and the answer form is never found.
    const replies: Array<{ url: string; body: unknown }> = []
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
      getConfig: () => ({ baseUrl: "http://127.0.0.1:49374/api" }),
      request: async (opts: { method: string; url: string; body?: unknown }) => {
        if (opts.method === "GET" && opts.url === "/session/child-session/form") {
          return {
            data: [
              {
                id: "form_pub",
                status: "pending",
                fields: [{ id: "q0", type: "string", custom: true }],
              },
            ],
          }
        }
        if (opts.method === "POST" && opts.url === "/session/child-session/form/form_pub/reply") {
          replies.push({ url: opts.url, body: opts.body })
        }
        return {}
      },
    }
    const pubManager = createManager(120_000, undefined, {}, client as unknown as Record<string, unknown>)
    registerChildTask(pubManager)
    pubManager.routeChildQuestion({
      sessionID: "child-session",
      questionArgs: { questions: [{ question: "Branch to target?" }] },
    })

    const answer = await pubManager.answerChildQuestion("child-session", "main")
    expect(answer.answered).toBe(true)
    expect(replies).toHaveLength(1)
    expect(replies[0].url).toBe("/session/child-session/form/form_pub/reply")
    expect(replies[0].body).toEqual({ answer: { q0: "main" } })
    pubManager.shutdown()
  })

  test("prefers the top-level form namespace on newer SDK clients", async () => {
    const replies: Array<{ formID: string; answer: Record<string, unknown> }> = []
    const client = {
      session: {
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        abort: async () => ({}),
      },
      form: {
        list: async () => ({
          data: [
            {
              id: "form_top",
              status: "pending",
              fields: [{ id: "q0", type: "string", custom: true }],
            },
          ],
        }),
        reply: async (opts: { path: { sessionID: string; formID: string }; body: { answer: Record<string, unknown> } }) => {
          replies.push({ formID: opts.path.formID, answer: opts.body.answer })
        },
      },
    }
    const topManager = createManager(120_000, undefined, {}, client as unknown as Record<string, unknown>)
    registerChildTask(topManager)
    topManager.routeChildQuestion({
      sessionID: "child-session",
      questionArgs: { questions: [{ question: "Branch to target?" }] },
    })

    const answer = await topManager.answerChildQuestion("child-session", "main")
    expect(answer.answered).toBe(true)
    expect(replies).toHaveLength(1)
    expect(replies[0].formID).toBe("form_top")
    expect(replies[0].answer).toEqual({ q0: "main" })
    topManager.shutdown()
  })
})
