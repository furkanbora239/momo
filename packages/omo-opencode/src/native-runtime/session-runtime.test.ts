import { describe, expect, it } from "bun:test"
import type { FormDetail, SessionInfo, SessionMessageInfo } from "@opencode/client"
import type { NativeTask, NativeTaskRepository } from "../native-task/types"
import { createNativeSessionRuntime } from "./session-runtime"
import type { NativeV2Client } from "./v2-service-client"

function harness() {
  const sessions = new Map<string, SessionInfo>()
  const forms = new Map<string, FormDetail>()
  const calls: Array<{ name: string; input: unknown }> = []
  let promptResponse: Promise<unknown> = Promise.resolve({})
  let beforeFormCreate: (() => Promise<void>) | undefined
  let activeSessions: Record<string, { type: "running" }> = {}
  let contextMessages: SessionMessageInfo[] = []
  const task: NativeTask = {
    id: "ntask_9f1bb0c3-2d9f-4b64-9ab5-73e92710fdc1",
    rootTaskID: "ntask_9f1bb0c3-2d9f-4b64-9ab5-73e92710fdc1",
    rootSessionID: "ses_root",
    parentSessionID: "ses_root",
    sessionID: "ses_child",
    kind: "task",
    parentRole: "orchestrator",
    role: "worker",
    model: { providerID: "momo-qa", id: "momo-qa-model" },
    state: "waiting_question",
    prompt: "do work",
    createdAt: 1,
    updatedAt: 1,
    attempts: 1,
    activeTools: [],
    childTaskIDs: [],
    processedEventIDs: [],
    lastActivityAt: 1,
    question: { id: "form_child", prompt: "Which project?", form: { fields: [{ key: "projectName", type: "string", required: true }] } },
    questionEscalated: false,
  }
  const repository = {
    get: async (id: string) => id === task.id ? task : undefined,
    list: async () => [task],
    save: async () => undefined,
  } satisfies NativeTaskRepository
  const childMetadata = {
    version: 1,
    taskID: task.id,
    rootSessionID: task.rootSessionID,
    parentSessionID: task.parentSessionID,
    role: task.role,
    model: task.model,
  }
  sessions.set("ses_root", makeSession({ id: "ses_root", agent: "orchestrator" }))
  sessions.set("ses_child", makeSession({ id: "ses_child", agent: "momo-worker", parentID: "ses_root", metadata: { momoNativeTask: childMetadata } }))

  const client = {
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        const session = sessions.get(sessionID)
        if (session === undefined) throw new Error("Session not found")
        return session
      },
      create: async (input: unknown) => {
        calls.push({ name: "create", input })
        const params = input as Record<string, unknown>
        const created = makeSession({ id: String(params.id), agent: String(params.agent), parentID: String(params.parentID), metadata: params.metadata as Record<string, unknown>, model: params.model as { providerID: string; id: string } })
        sessions.set(created.id, created)
        return created
      },
      active: async () => activeSessions,
      context: async () => contextMessages,
      prompt: (input: unknown) => { calls.push({ name: "prompt", input }); return promptResponse },
      synthetic: async (input: unknown) => { calls.push({ name: "synthetic", input }); return {} },
      interrupt: async (input: unknown) => { calls.push({ name: "interrupt", input }); return {} },
      form: {
        list: async ({ sessionID }: { sessionID: string }) => [...forms.values()].filter((form) => form.sessionID === sessionID),
        create: async (input: unknown) => {
          calls.push({ name: "form.create", input })
          await beforeFormCreate?.()
          const params = input as Record<string, unknown>
          const form = makeForm(String(params.id), String(params.sessionID), String(params.title), params.metadata as Record<string, unknown> | undefined)
          forms.set(`${form.sessionID}:${form.id}`, form)
          return form
        },
        get: async ({ sessionID, formID }: { sessionID: string; formID: string }) => {
          const form = forms.get(`${sessionID}:${formID}`)
          if (form === undefined) throw new Error("Form not found")
          return form
        },
        reply: async (input: unknown) => { calls.push({ name: "form.reply", input }) },
        cancel: async ({ sessionID, formID }: { sessionID: string; formID: string }) => { calls.push({ name: "form.cancel", input: { sessionID, formID } }); forms.delete(`${sessionID}:${formID}`) },
      },
    },
  } as unknown as NativeV2Client
  return {
    task,
    calls,
    sessions,
    forms,
    repository,
    runtime: createNativeSessionRuntime({
      client,
      repository,
      resolveOwnedRole: (session) => session.agent === "orchestrator" ? "orchestrator" : session.agent === "worker" || session.agent === "momo-worker" ? "worker" : undefined,
      resolveOwnedAgentID: (role) => role === "worker" ? "momo-worker" : "momo-orchestrator",
      verifySessionOwner: async () => undefined,
      onParentAnswer: async (taskID, questionID, answer, replyingSessionID) => { calls.push({ name: "parent.answer", input: { taskID, questionID, answer, replyingSessionID } }) },
    }),
    setPromptResponse: (response: Promise<unknown>) => { promptResponse = response },
    setBeforeFormCreate: (action: (() => Promise<void>) | undefined) => { beforeFormCreate = action },
    setActive: (value: Record<string, { type: "running" }>) => { activeSessions = value },
    setContext: (value: SessionMessageInfo[]) => { contextMessages = value },
  }
}

function makeSession(input: { id: string; agent?: string; parentID?: string; metadata?: Record<string, unknown>; outcome?: "succeeded" | "failed" | "interrupted"; model?: { providerID: string; id: string }; tokens?: { input: number; output: number } }): SessionInfo {
  return {
    id: input.id,
    ...(input.parentID !== undefined ? { parentID: input.parentID } : {}),
    projectID: "project-momo",
    ...(input.agent !== undefined ? { agent: input.agent } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
    cost: 0,
    tokens: { input: input.tokens?.input ?? 0, output: input.tokens?.output ?? 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, updated: 1 },
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
    location: { directory: "/workspace" },
  }
}

function makeForm(id: string, sessionID: string, title: string, metadata?: Record<string, unknown>): FormDetail {
  return { id, sessionID, title, ...(metadata !== undefined ? { metadata } : {}), fields: [{ key: "projectName", type: "string", required: true }], state: { status: "pending" } }
}

describe("native V2 session runtime", () => {
  it("persists deterministic child identity and rejects an unowned caller", async () => {
    const h = harness()
    const root = await h.runtime.resolveCaller("ses_root")
    expect(root).toEqual({ role: "orchestrator", rootSessionID: "ses_root" })
    const child = await h.runtime.resolveCaller("ses_child")
    expect(child).toEqual({ role: "worker", rootSessionID: "ses_root" })
    await expect(h.runtime.resolveCaller("ses_unowned")).rejects.toThrow("Session not found")

    const created = await h.runtime.createSession({
      taskID: "ntask_9f1bb0c3-2d9f-4b64-9ab5-73e92710fdc1",
      rootSessionID: "ses_root",
      parentSessionID: "ses_root",
      role: "worker",
      model: { providerID: "momo-qa", id: "momo-qa-model" },
    })
    expect(created.sessionID).toMatch(/^ses_[a-f0-9]{26}$/)
    const args = h.calls.find((call) => call.name === "create")?.input as Record<string, unknown>
    expect(args).toMatchObject({
      id: created.sessionID,
      parentID: "ses_root",
      agent: "momo-worker",
      model: { providerID: "momo-qa", id: "momo-qa-model" },
      location: { directory: "/workspace" },
    })
    expect((args.metadata as Record<string, unknown>).momoNativeTask).toMatchObject({ taskID: h.task.id, rootSessionID: "ses_root", role: "worker" })
  })

  it("queues idempotent synthetic results without waking the parent and launches task prompts without waiting for generation", async () => {
    const h = harness()
    await h.runtime.deliver({ parentSessionID: "ses_root", taskID: h.task.id, result: "done" })
    const result = h.calls.find((call) => call.name === "synthetic")?.input as Record<string, unknown>
    expect(result).toMatchObject({ sessionID: "ses_root", delivery: "queue", resume: true, text: "done" })

    let release: (() => void) | undefined
    h.setPromptResponse(new Promise<void>((resolve) => { release = resolve }))
    const prior = h.calls.find((call) => call.name === "prompt")
    expect(prior).toBeUndefined()
    await expect(h.runtime.start({ sessionID: "ses_child", prompt: "execute" })).resolves.toBeUndefined()
    const prompt = h.calls.find((call) => call.name === "prompt")?.input as Record<string, unknown>
    expect(prompt).toMatchObject({ sessionID: "ses_child", text: "execute", delivery: "queue" })
    release?.()
  })

  it("creates a managed parent form without bypassing the task scheduler through a synthetic wake", async () => {
    const h = harness()
    h.task.parentTaskID = "department"
    await h.runtime.ask({ parentSessionID: "ses_root", taskID: h.task.id, question: h.task.question! })
    expect(h.calls.filter((call) => call.name === "form.create")).toHaveLength(1)
    expect(h.calls.filter((call) => call.name === "synthetic")).toHaveLength(0)
  })

  it("creates field-keyed native forms and routes root escalation answers back to the child form", async () => {
    const h = harness()
    await h.runtime.ask({ parentSessionID: "ses_root", taskID: h.task.id, question: h.task.question! })
    const created = h.calls.find((call) => call.name === "form.create")?.input as Record<string, unknown>
    expect(created).toMatchObject({ sessionID: "ses_root", title: "Which project?", fields: [{ key: "projectName", type: "string" }] })
    const metadata = created.metadata as Record<string, unknown>
    expect(metadata).toMatchObject({ momoNativeFormKind: "question", momoNativeTaskID: h.task.id, momoNativeQuestionID: "form_child" })
    const notification = h.calls.filter((call) => call.name === "synthetic").at(-1)?.input as Record<string, unknown>
    expect(notification).toMatchObject({ sessionID: "ses_root", resume: true, delivery: "queue", metadata: { momoNativeQuestionNotification: { taskID: h.task.id, questionID: "form_child" } } })

    h.forms.set("ses_child:form_child", makeForm("form_child", "ses_child", "Which project?", { momoNativeFormKind: "question" }))
    h.task.questionEscalated = true
    await h.runtime.escalateQuestion({ rootSessionID: "ses_root", taskID: h.task.id, question: h.task.question! })
    const escalation = [...h.calls].reverse().find((call) => call.name === "form.create")?.input as Record<string, unknown>
    const escalationID = String(escalation.id)
    await h.runtime.answer({ sessionID: "ses_child", questionID: "form_child", answer: "momo" })
    expect(h.calls.find((call) => call.name === "form.reply")?.input).toMatchObject({
      sessionID: "ses_child", formID: "form_child", answer: { projectName: "momo" },
    })
    expect(h.calls.filter((call) => call.name === "form.cancel")).toHaveLength(2)
    const escalationMetadata = escalation.metadata as Record<string, unknown>
    h.forms.set(`ses_root:${escalationID}`, makeForm(escalationID, "ses_root", "Which project?", escalationMetadata))
    expect(await h.runtime.onFormEvent({ id: "form-replied-1", created: 1, type: "form.replied", data: { id: escalationID, sessionID: "ses_root", answer: { projectName: "root-answer" } } })).toBe(true)
    expect(h.calls.at(-1)).toMatchObject({
      name: "parent.answer",
      input: { taskID: h.task.id, questionID: "form_child", answer: { projectName: "root-answer" }, replyingSessionID: "ses_root" },
    })
  })

  it("closes a forwarded question form if the parent answers while form creation is in flight", async () => {
    const h = harness()
    let releaseCreate: (() => void) | undefined
    h.setBeforeFormCreate(() => new Promise<void>((resolve) => { releaseCreate = resolve }))
    const pendingAsk = h.runtime.ask({ parentSessionID: "ses_root", taskID: h.task.id, question: h.task.question! })
    for (let attempt = 0; attempt < 8 && releaseCreate === undefined; attempt += 1) await Promise.resolve()
    expect(releaseCreate).toBeDefined()
    h.task.answer = "parent answered"
    h.task.state = "queued"
    releaseCreate?.()
    await pendingAsk

    expect(h.calls.some((call) => call.name === "synthetic")).toBe(false)
    expect(h.calls.filter((call) => call.name === "form.cancel")).toHaveLength(1)
    expect(h.forms.size).toBe(0)
  })

  it("marks forwarded momo forms consumed so parent questions do not re-enter task event mapping", async () => {
    const h = harness()
    const consumed = await h.runtime.onFormEvent({
      id: "forwarded-created", created: 1, type: "form.created",
      data: { form: { id: "frm-forwarded", sessionID: "ses_root", title: "Question", fields: [], metadata: { momoNativeFormKind: "question" } } },
    })
    const original = await h.runtime.onFormEvent({
      id: "original-created", created: 2, type: "form.created",
      data: { form: { id: "frm-original", sessionID: "ses_child", title: "Question", fields: [], metadata: {} } },
    })
    expect(consumed).toBe(true)
    expect(original).toBe(false)
  })

  it("inspects native active state and completed assistant context instead of idle events", async () => {
    const h = harness()
    h.setActive({ ses_child: { type: "running" } })
    expect(await h.runtime.inspect("ses_child")).toEqual({ state: "running" })
    h.setActive({})
    h.sessions.set("ses_child", makeSession({
      id: "ses_child",
      agent: "momo-worker",
      parentID: "ses_root",
      outcome: "succeeded",
      tokens: { input: 31, output: 9 },
      metadata: { momoNativeTask: {
        version: 1,
        taskID: h.task.id,
        rootSessionID: "ses_root",
        parentSessionID: "ses_root",
        role: "worker",
        model: h.task.model,
      } },
    }))
    h.setContext([{
      id: "assistant-1",
      type: "assistant",
      agent: "momo-worker",
      model: { providerID: "momo-qa", id: "momo-qa-model" },
      time: { created: 1, completed: 2 },
      finish: "stop",
      content: [{ type: "text", text: "native result" }],
    }])

    expect(await h.runtime.inspect("ses_child")).toEqual({ state: "succeeded", result: "native result", usage: { inputTokens: 31, outputTokens: 9, scope: "session_cumulative" } })
    expect(await h.runtime.inspect("ses_missing")).toEqual({ state: "missing" })
  })
})
