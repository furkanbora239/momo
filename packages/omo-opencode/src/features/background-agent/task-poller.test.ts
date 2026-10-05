declare const require: (name: string) => any
const { describe, it, expect, mock, spyOn, beforeEach, afterEach } = require("bun:test")

import { checkAndInterruptStaleTasks, pruneStaleTasksAndNotifications } from "./task-poller"
import { BackgroundManager } from "./manager"
import { tmpdir } from "node:os"
import type { BackgroundTask } from "./types"

describe("checkAndInterruptStaleTasks", () => {
  const mockClient = {
    session: {
      abort: mock(() => Promise.resolve()),
      get: mock(() => Promise.resolve({ data: { id: "ses-1" } })),
    },
  }
  const mockConcurrencyManager = {
    release: mock(() => {}),
  }
  const mockNotify = mock(() => Promise.resolve())

  function createDeferredPromise(): {
    promise: Promise<void>
    resolve: () => void
  } {
    let resolvePromise = () => {}
    const promise = new Promise<void>((resolve) => {
      resolvePromise = resolve
    })
    return {
      promise,
      resolve: resolvePromise,
    }
  }

  function createRunningTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
    return {
      id: "task-1",
      sessionId: "ses-1",
      parentSessionId: "parent-ses-1",
      parentMessageId: "msg-1",
      description: "test",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(Date.now() - 120_000),
      ...overrides,
    }
  }
  const originalDateNow = Date.now
  let fixedTime: number

  beforeEach(() => {
    fixedTime = Date.now()
    spyOn(globalThis.Date, "now").mockReturnValue(fixedTime)
    mockClient.session.abort.mockClear()
    mockClient.session.get.mockReset()
    mockClient.session.get.mockResolvedValue({ data: { id: "ses-1" } })
    mockConcurrencyManager.release.mockClear()
    mockNotify.mockClear()
  })

  afterEach(() => {
    Date.now = originalDateNow
  })


  it("should interrupt tasks with lastUpdate exceeding stale timeout", async () => {
    //#given
    const task = createRunningTask({
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 200_000),
      },
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it("should NOT interrupt tasks with recent lastUpdate", async () => {
    //#given
    const task = createRunningTask({
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 10_000),
      },
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })

    //#then
    expect(task.status).toBe("running")
  })

  it("should NOT interrupt idle team-member tasks just because lastUpdate is old", async () => {
    //#given
    const task = createRunningTask({
      teamRunId: "team-run-1",
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 200_000),
      },
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "idle" } },
    })

    //#then
    expect(task.status).toBe("running")
  })

  it("should NOT interrupt team-member tasks when the session is merely absent from the registry (UNKNOWN)", async () => {
    //#given
    const task = createRunningTask({
      teamRunId: "team-run-1",
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 200_000),
      },
      consecutiveMissedPolls: 2,
    })
    mockClient.session.get.mockRejectedValueOnce(new Error("missing"))

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then - registry-absence is UNKNOWN; the task keeps running and is never interrupted
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()
    expect(mockClient.session.abort).not.toHaveBeenCalled()
  })

  it("should interrupt tasks with NO progress.lastUpdate that exceeded messageStalenessTimeoutMs since startedAt", async () => {
    //#given - task started 15 minutes ago, never received any progress update
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("no activity")
    expect(task.error).toContain("messageStalenessTimeoutMs")
  })

  it("should keep never-updated task running when stale abort returns SDK error", async () => {
    //#given
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
      concurrencyKey: "anthropic/claude-opus-4-7",
    })
    const releaseMock = mock(() => {})
    const onTaskInterrupted = mock(() => {})
    mockClient.session.abort.mockImplementationOnce(() => Promise.resolve({ error: { message: "still running" } }))

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: { release: releaseMock } as never,
      notifyParentSession: mockNotify,
      onTaskInterrupted,
    })

    //#then
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()
    expect(task.concurrencyKey).toBe("anthropic/claude-opus-4-7")
    expect(releaseMock).not.toHaveBeenCalled()
    expect(onTaskInterrupted).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it("should await abort before resolving for no-progress stale interruption", async () => {
    //#given
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
    })
    const deferred = createDeferredPromise()
    mockClient.session.abort.mockImplementationOnce(() => deferred.promise)

    //#when
    const interruptPromise = checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })
    let settled = false
    void interruptPromise.then(() => {
      settled = true
    })

    await Promise.resolve()

    //#then
    expect(settled).toBe(false)

    deferred.resolve()
    await interruptPromise

    expect(settled).toBe(true)
  })

  it("should NOT interrupt tasks with NO progress.lastUpdate that are within messageStalenessTimeoutMs", async () => {
    //#given - task started 5 minutes ago, default timeout is 10 minutes
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 5 * 60 * 1000),
      progress: undefined,
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })

    //#then
    expect(task.status).toBe("running")
  })

  it("should use DEFAULT_MESSAGE_STALENESS_TIMEOUT_MS when messageStalenessTimeoutMs is not configured", async () => {
    //#given - task started 65 minutes ago, no config for messageStalenessTimeoutMs
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 65 * 60 * 1000),
      progress: undefined,
    })

    //#when - default is 60 minutes (3_600_000ms)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: undefined,
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("no activity")
  })

  it("should NOT interrupt busy session when progress is within the configured stale timeout", async () => {
    //#given - session is busy and progress was observed recently
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 60_000),
      },
    })

    //#when - session status is "busy" (OpenCode's actual status for active LLM processing)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then
    expect(task.status).toBe("running")
  })

  it("should interrupt busy session task when lastUpdate exceeds stale timeout", async () => {
    //#given - the session still reports busy, but no progress arrived within the configured timeout
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 900_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 900_000),
      },
    })

    //#when - session busy, lastUpdate far exceeds any timeout
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it("should keep stale-progress task running when abort returns SDK error", async () => {
    //#given
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 900_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 900_000),
      },
      concurrencyKey: "anthropic/claude-opus-4-7",
    })
    const releaseMock = mock(() => {})
    const onTaskInterrupted = mock(() => {})
    mockClient.session.abort.mockImplementationOnce(() => Promise.resolve({ error: { message: "still running" } }))

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: { release: releaseMock } as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
      onTaskInterrupted,
    })

    //#then
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()
    expect(task.concurrencyKey).toBe("anthropic/claude-opus-4-7")
    expect(releaseMock).not.toHaveBeenCalled()
    expect(onTaskInterrupted).not.toHaveBeenCalled()
    expect(mockNotify).not.toHaveBeenCalled()
  })

  it("should abort multiple stale-progress tasks concurrently before marking them cancelled", async () => {
    //#given
    const firstAbort = createDeferredPromise()
    const secondAbort = createDeferredPromise()
    const abortSessionIDs: string[] = []
    const taskA = createRunningTask({
      id: "task-stale-a",
      sessionId: "ses-stale-a",
      parentSessionId: "parent-stale-a",
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 900_000),
      },
    })
    const taskB = createRunningTask({
      id: "task-stale-b",
      sessionId: "ses-stale-b",
      parentSessionId: "parent-stale-b",
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 900_000),
      },
    })
    mockClient.session.abort.mockImplementation(({ path }: { path: { id: string } }) => {
      abortSessionIDs.push(path.id)
      return path.id === "ses-stale-a" ? firstAbort.promise : secondAbort.promise
    })

    //#when
    const interruption = checkAndInterruptStaleTasks({
      tasks: [taskA, taskB],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
    })
    await Promise.resolve()

    //#then
    expect(abortSessionIDs).toEqual(["ses-stale-a", "ses-stale-b"])
    expect(taskA.status).toBe("running")
    expect(taskB.status).toBe("running")

    firstAbort.resolve()
    secondAbort.resolve()
    await interruption

    expect(taskA.status).toBe("cancelled")
    expect(taskB.status).toBe("cancelled")
  })

  it("should NOT interrupt busy session with no progress within message staleness timeout", async () => {
    //#given - task has no progress yet, but it is still inside the configured first-progress window
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 5 * 60 * 1000),
      progress: undefined,
    })

    //#when - session is busy
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then
    expect(task.status).toBe("running")
  })

  it("should interrupt busy session when it exceeds configured no-progress timeout", async () => {
    //#given - the session reports busy, but no progress event arrived within the configured timeout
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("no activity")
    expect(mockNotify).toHaveBeenCalledWith(task)
  })

  it("should interrupt task when session is idle and lastUpdate exceeds stale timeout", async () => {
    //#given - lastUpdate is 5min old and session is idle
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when - session status is "idle"
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "idle" } },
    })

    //#then - task should be killed because session is idle with stale lastUpdate
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it("should interrupt running session task when lastUpdate exceeds stale timeout", async () => {
    //#given - the session reports running, but no progress arrived within the configured timeout
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 900_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 900_000),
      },
    })

    //#when - session running, lastUpdate far exceeds any timeout
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "running" } },
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it("should interrupt running session with no progress after message staleness timeout", async () => {
    //#given - the session reports running, but no progress ever arrived within the configured timeout
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
    })

    //#when - session is running
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "running" } },
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("no activity")
  })

  it("should NOT cancel healthy task on first missing status poll", async () => {
    //#given - one missing poll should not be enough to declare the session gone
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then
    expect(task.status).toBe("running")
    expect(task.consecutiveMissedPolls).toBe(1)
    expect(mockClient.session.get).not.toHaveBeenCalled()
  })

  it("should NOT cancel task when the session is absent (UNKNOWN) and should not consult session.get", async () => {
    //#given - repeated missing polls but direct lookup would succeed
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
      consecutiveMissedPolls: 2,
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then - absence is UNKNOWN; kept waiting and session.get is never consulted
    expect(task.status).toBe("running")
    expect(task.consecutiveMissedPolls).toBe(3)
    expect(mockClient.session.get).not.toHaveBeenCalled()
  })

  it("should NOT cancel and should keep counting missed polls when session is absent (UNKNOWN)", async () => {
    //#given - repeated missing polls (session.get would fail with a transient error)
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
      consecutiveMissedPolls: 2,
    })

    mockClient.session.get.mockResolvedValue({
      error: { message: "Network timeout", status: 500 },
      data: undefined,
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then - absence is UNKNOWN; kept waiting, poll counter increments, session.get not consulted
    expect(task.status).toBe("running")
    expect(task.consecutiveMissedPolls).toBe(3)
    expect(mockClient.session.get).not.toHaveBeenCalled()
  })

  it("should keep running (UNKNOWN) when session is missing from status map (with progress)", async () => {
    //#given - lastUpdate 2min ago, session completely gone from status
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
      consecutiveMissedPolls: 2,
    })

    mockClient.session.get.mockRejectedValue(new Error("missing"))

    //#when - empty sessionStatuses (session absent), sessionGoneTimeoutMs = 60s
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then - registry-absence is UNKNOWN; never interrupted on absence alone
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()
    expect(mockClient.session.abort).not.toHaveBeenCalled()
  })

  it("should NOT await an abort for a session-gone (UNKNOWN) interruption because none is issued", async () => {
    //#given
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
      consecutiveMissedPolls: 2,
    })
    const deferred = createDeferredPromise()
    mockClient.session.get.mockRejectedValue(new Error("missing"))
    mockClient.session.abort.mockImplementationOnce(() => deferred.promise)

    //#when
    const interruptPromise = checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })
    let settled = false
    void interruptPromise.then(() => {
      settled = true
    })

    await Promise.resolve()

    //#then - no abort is issued for an absent (UNKNOWN) session, so it resolves immediately
    expect(settled).toBe(true)
    expect(mockClient.session.abort).not.toHaveBeenCalled()

    deferred.resolve()
    await interruptPromise
  })

  it("should keep running (UNKNOWN) when session is missing from status map (no progress)", async () => {
    //#given - task started 2min ago, no progress, session completely gone
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 120_000),
      progress: undefined,
      consecutiveMissedPolls: 2,
    })

    mockClient.session.get.mockRejectedValue(new Error("missing"))

    //#when - session absent, sessionGoneTimeoutMs = 60s
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then - registry-absence is UNKNOWN; never interrupted on absence alone
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()
    expect(mockClient.session.abort).not.toHaveBeenCalled()
  })

  it("should NOT use session-gone timeout when session is idle (present in status map)", async () => {
    //#given - lastUpdate 2min ago, session is idle (present in status but not active)
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
      consecutiveMissedPolls: 2,
    })

    mockClient.session.get.mockRejectedValue(new Error("missing"))

    //#when - session is idle (present in map), staleTimeoutMs = 180s
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000, sessionGoneTimeoutMs: 60_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "idle" } },
    })

    //#then - still running because normal staleTimeout (180s) > timeSinceLastUpdate (120s)
    expect(task.status).toBe("running")
  })

  it("should keep running (UNKNOWN) when session is missing and no sessionGoneTimeoutMs is configured", async () => {
    //#given - lastUpdate 2min ago, session gone, no sessionGoneTimeoutMs config
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 120_000),
      },
      consecutiveMissedPolls: 2,
    })

    mockClient.session.get.mockRejectedValue(new Error("missing"))

    //#when - no config (default sessionGoneTimeoutMs = 60_000)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: undefined,
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: {},
    })

    //#then - registry-absence is UNKNOWN; never interrupted on absence alone
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()
    expect(mockClient.session.abort).not.toHaveBeenCalled()
  })

  it("should interrupt task when busy session exceeds stale timeout", async () => {
    //#given - lastUpdate is 5min old and session is still "busy"
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when - session status is "busy" (not "running" - OpenCode uses "busy" for active LLM processing)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it("should interrupt task when retry session exceeds stale timeout", async () => {
    //#given - lastUpdate is 5min old but session is retrying
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when - session status is "retry" (OpenCode retries on transient API errors)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "retry" } },
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it("should interrupt busy session with no progress after message staleness timeout", async () => {
    //#given - no progress at all, session is still "busy"
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
    })

    //#when - session is busy
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("no activity")
  })

  it("should release concurrency key when interrupting a never-updated task", async () => {
    //#given
    const releaseMock = mock(() => {})
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 15 * 60 * 1000),
      progress: undefined,
      concurrencyKey: "anthropic/claude-opus-4-7",
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { messageStalenessTimeoutMs: 600_000 },
      concurrencyManager: { release: releaseMock } as never,
      notifyParentSession: mockNotify,
    })

    //#then
    expect(releaseMock).toHaveBeenCalledWith("anthropic/claude-opus-4-7")
    expect(task.concurrencyKey).toBeUndefined()
  })

  it("should invoke interruption callback immediately when stale task is cancelled", async () => {
    //#given
    const task = createRunningTask({
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 200_000),
      },
    })
    const onTaskInterrupted = mock(() => {})

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      onTaskInterrupted,
    })

    //#then
    expect(task.status).toBe("cancelled")
    expect(onTaskInterrupted).toHaveBeenCalledWith(task)
  })

  it('should NOT protect task when session has terminal non-idle status like "interrupted"', async () => {
    //#given - lastUpdate is 5min old, session is "interrupted" (terminal, not active)
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when - session status is "interrupted" (terminal)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "interrupted" } },
    })

    //#then - terminal statuses should not protect from stale timeout
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it('should NOT protect task when session has unknown status type', async () => {
    //#given - lastUpdate is 5min old, session has an unknown status
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 300_000),
      progress: {
        toolCalls: 2,
        lastUpdate: new Date(Date.now() - 300_000),
      },
    })

    //#when - session has unknown status type
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "some-weird-status" } },
    })

    //#then - unknown statuses should not protect from stale timeout
    expect(task.status).toBe("cancelled")
    expect(task.error).toContain("Stale timeout")
  })

  it("should NOT interrupt task when an active tool (e.g. bash test) is running even if lastUpdate exceeds stale timeout", async () => {
    //#given - lastUpdate was 15 minutes ago, but bash is actively running
    const task = createRunningTask({
      startedAt: new Date(Date.now() - 20 * 60 * 1000),
      progress: {
        toolCalls: 5,
        lastTool: "bash",
        activeTool: "bash",
        activeToolStartedAt: new Date(Date.now() - 15 * 60 * 1000),
        lastUpdate: new Date(Date.now() - 15 * 60 * 1000),
      },
    })

    //#when
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: mockClient as never,
      config: { staleTimeoutMs: 180_000 },
      concurrencyManager: mockConcurrencyManager as never,
      notifyParentSession: mockNotify,
      sessionStatuses: { "ses-1": { type: "busy" } },
    })

    //#then - task should remain running because activeTool is still executing
    expect(task.status).toBe("running")
    expect(mockClient.session.abort).not.toHaveBeenCalled()
  })
})

describe("pruneStaleTasksAndNotifications", () => {
  function createTerminalTask(overrides: Partial<BackgroundTask> = {}): BackgroundTask {
    return {
      id: "terminal-task",
      parentSessionId: "parent",
      parentMessageId: "msg",
      description: "terminal",
      prompt: "terminal",
      agent: "explore",
      status: "completed",
      startedAt: new Date(Date.now() - 40 * 60 * 1000),
      completedAt: new Date(Date.now() - 31 * 60 * 1000),
      ...overrides,
    }
  }

  it("should prune tasks that exceeded TTL", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const oldTask: BackgroundTask = {
      id: "old-task",
      parentSessionId: "parent",
      parentMessageId: "msg",
      description: "old",
      prompt: "old",
      agent: "explore",
      status: "running",
      startedAt: new Date(Date.now() - 31 * 60 * 1000),
    }
    tasks.set("old-task", oldTask)

    const pruned: string[] = []
    const notifications = new Map<string, BackgroundTask[]>()

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications,
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toContain("old-task")
  })

  it("#given running task with recent progress #when startedAt exceeds TTL #then should NOT prune", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const activeTask: BackgroundTask = {
      id: "active-task",
      parentSessionId: "parent",
      parentMessageId: "msg",
      description: "active",
      prompt: "active",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 45 * 60 * 1000),
      progress: {
        toolCalls: 10,
        lastUpdate: new Date(Date.now() - 5 * 60 * 1000),
      },
    }
    tasks.set("active-task", activeTask)

    const pruned: string[] = []
    const notifications = new Map<string, BackgroundTask[]>()

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications,
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toEqual([])
  })

  it("#given running task with stale progress #when lastUpdate exceeds TTL #then should prune", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const staleTask: BackgroundTask = {
      id: "stale-task",
      parentSessionId: "parent",
      parentMessageId: "msg",
      description: "stale",
      prompt: "stale",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      progress: {
        toolCalls: 10,
        lastUpdate: new Date(Date.now() - 35 * 60 * 1000),
      },
    }
    tasks.set("stale-task", staleTask)

    const pruned: string[] = []
    const notifications = new Map<string, BackgroundTask[]>()

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications,
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toContain("stale-task")
  })

  it("#given running task with stale progress and active session #when lastUpdate exceeds TTL #then should NOT prune", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const activeTask: BackgroundTask = {
      id: "active-status-task",
      sessionId: "ses-active-status",
      parentSessionId: "parent",
      parentMessageId: "msg",
      description: "active status",
      prompt: "active status",
      agent: "oracle",
      status: "running",
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      progress: {
        toolCalls: 10,
        lastUpdate: new Date(Date.now() - 35 * 60 * 1000),
      },
    }
    tasks.set("active-status-task", activeTask)

    const pruned: string[] = []
    const notifications = new Map<string, BackgroundTask[]>()

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications,
      sessionStatuses: { "ses-active-status": { type: "busy" } },
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toEqual([])
    expect(tasks.has("active-status-task")).toBe(true)
  })

  it("#given custom taskTtlMs #when task exceeds custom TTL #then should prune", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const task: BackgroundTask = {
      id: "custom-ttl-task",
      parentSessionId: "parent",
      parentMessageId: "msg",
      description: "custom",
      prompt: "custom",
      agent: "explore",
      status: "running",
      startedAt: new Date(Date.now() - 61 * 60 * 1000),
    }
    tasks.set("custom-ttl-task", task)

    const pruned: string[] = []
    const notifications = new Map<string, BackgroundTask[]>()

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications,
      taskTtlMs: 60 * 60 * 1000,
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toContain("custom-ttl-task")
  })

  it("#given custom taskTtlMs #when task within custom TTL #then should NOT prune", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const task: BackgroundTask = {
      id: "within-ttl-task",
      parentSessionId: "parent",
      parentMessageId: "msg",
      description: "within",
      prompt: "within",
      agent: "explore",
      status: "running",
      startedAt: new Date(Date.now() - 45 * 60 * 1000),
    }
    tasks.set("within-ttl-task", task)

    const pruned: string[] = []
    const notifications = new Map<string, BackgroundTask[]>()

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications,
      taskTtlMs: 60 * 60 * 1000,
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toEqual([])
  })

  it("#given active team-member task with stale progress #when prune runs #then should NOT prune", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const task: BackgroundTask = {
      id: "team-task",
      sessionID: "ses-team-1",
      parentSessionID: "parent",
      parentMessageID: "msg",
      teamRunId: "team-run-1",
      description: "team member",
      prompt: "team member",
      agent: "sisyphus-junior",
      status: "running",
      startedAt: new Date(Date.now() - 60 * 60 * 1000),
      progress: {
        toolCalls: 1,
        lastUpdate: new Date(Date.now() - 35 * 60 * 1000),
      },
    }
    tasks.set(task.id, task)

    const pruned: string[] = []

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications: new Map<string, BackgroundTask[]>(),
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toEqual([])
    expect(tasks.has(task.id)).toBe(true)
  })

  it("should prune terminal tasks when completion time exceeds terminal TTL", () => {
    //#given
    const tasks = new Map<string, BackgroundTask>()
    const terminalStatuses: BackgroundTask["status"][] = ["completed", "error", "cancelled", "interrupt"]

    for (const status of terminalStatuses) {
      tasks.set(status, createTerminalTask({
        id: status,
        description: status,
        prompt: status,
        status,
      }))
    }

    const pruned: string[] = []

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications: new Map<string, BackgroundTask[]>(),
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toEqual([])
    expect(Array.from(tasks.keys())).toEqual([])
  })

  it("should keep terminal tasks with pending notifications until notification cleanup", () => {
    //#given
    const task = createTerminalTask()
    const tasks = new Map<string, BackgroundTask>([[task.id, task]])
    const notifications = new Map<string, BackgroundTask[]>([[task.parentSessionId, [task]]])
    const pruned: string[] = []

    //#when
    pruneStaleTasksAndNotifications({
      tasks,
      notifications,
      onTaskPruned: (taskId) => pruned.push(taskId),
    })

    //#then
    expect(pruned).toEqual([])
    expect(tasks.has(task.id)).toBe(true)
    expect(notifications.has(task.parentSessionId)).toBe(false)
  })
})

describe("background-agent kill-storm hardening (M1b)", () => {
  function createPluginContext(client: object) {
    const directory = tmpdir()
    return {
      project: { id: "test-project", worktree: directory, time: { created: Date.now() } },
      directory,
      worktree: directory,
      serverUrl: new URL("http://localhost:4096"),
      $: {} as never,
      client: client as never,
    }
  }

  function createManager(client: object): BackgroundManager {
    return new BackgroundManager({
      pluginContext: createPluginContext(client) as never,
      config: undefined,
      enableParentSessionNotifications: false,
    })
  }

  function makeRunningTask(sessionId: string): BackgroundTask {
    return {
      id: `bg_${sessionId}`,
      sessionId,
      parentSessionId: "parent-session",
      parentMessageId: "parent-msg",
      description: "test",
      prompt: "test",
      agent: "explore",
      status: "running",
      startedAt: new Date(),
      progress: { toolCalls: 0, lastUpdate: new Date() },
    }
  }

  // (a) registry-absence -> wait branch, task NOT completed (poller)
  it("#given session absent from registry #when checkAndInterruptStaleTasks runs #then task is NOT interrupted/completed", async () => {
    //#given
    const abort = mock(() => Promise.resolve({}))
    const client = {
      session: { abort, get: mock(() => Promise.resolve({ data: { id: "ses-1" } })) },
    }
    const concurrencyRelease = mock(() => {})
    const notify = mock(() => Promise.resolve())
    const task = makeRunningTask("ses-1")

    //#when - empty sessionStatuses means the session is absent (UNKNOWN)
    await checkAndInterruptStaleTasks({
      tasks: [task],
      client: client as never,
      config: { staleTimeoutMs: 1, sessionGoneTimeoutMs: 1 },
      concurrencyManager: { release: concurrencyRelease } as never,
      notifyParentSession: notify,
      sessionStatuses: {},
    })

    //#then - absence is UNKNOWN; task keeps running and is never interrupted
    expect(task.status).toBe("running")
    expect(abort).not.toHaveBeenCalled()
  })

  // (d) cleanup safety: no interrupt/delete call when evidence is non-terminal (manager)
  it("#given an actively-running child with output #when pollRunningTasks runs #then no abort/delete is issued", async () => {
    //#given - child reports "busy" (active) and has produced output so far
    const abort = mock(() => Promise.resolve({}))
    const manager = createManager({
      session: {
        status: async () => ({ data: { "ses-busy": { type: "busy" } } }),
        abort,
        get: mock(() => Promise.resolve({ data: { id: "ses-busy" } })),
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        todo: async () => ({ data: [] }),
        messages: async () => ({ data: [{ info: { role: "assistant", id: "m" }, parts: [{ type: "text", text: "working" }] }] }),
      },
    })
    const task = makeRunningTask("ses-busy")
    manager["tasks"].set(task.id, task)

    //#when
    await manager["pollRunningTasks"]()

    //#then - a live, active child is never interrupted or deleted by the poll
    expect(task.status).toBe("running")
    expect(abort).not.toHaveBeenCalled()
    await manager.shutdown()
  })

  // (b) mid-flight output only -> NOT completion evidence
  it("#given a child whose session is absent (UNKNOWN) but has mid-flight output #when pollRunningTasks runs #then task is NOT completed", async () => {
    //#given - session absent from the registry, but the session has produced assistant text mid-flight
    const abort = mock(() => Promise.resolve({}))
    const manager = createManager({
      session: {
        status: async () => ({ data: {} }),
        abort,
        get: mock(() => Promise.resolve({ data: { id: "ses-mid" } })),
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        todo: async () => ({ data: [] }),
        messages: async () => ({ data: [{ info: { role: "assistant", id: "m" }, parts: [{ type: "text", text: "half-done..." }] }] }),
      },
    })
    const task = makeRunningTask("ses-mid")
    manager["tasks"].set(task.id, task)

    //#when
    await manager["pollRunningTasks"]()

    //#then - mid-flight output alone is NOT completion evidence; task keeps running
    expect(task.status).toBe("running")
    expect(abort).not.toHaveBeenCalled()
    await manager.shutdown()
  })

  // (c) terminal/deleted status -> complete allowed
  it("#given a child at idle status with valid output #when pollRunningTasks runs #then task completes", async () => {
    //#given - idle status is the genuinely-finished-child signal, corroborated by output
    const abort = mock(() => Promise.resolve({}))
    const manager = createManager({
      session: {
        status: async () => ({ data: { "ses-idle": { type: "idle" } } }),
        abort,
        get: mock(() => Promise.resolve({ data: { id: "ses-idle" } })),
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        todo: async () => ({ data: [] }),
        messages: async () => ({ data: [{ info: { role: "assistant", id: "m" }, parts: [{ type: "text", text: "done" }] }] }),
      },
    })
    const task = makeRunningTask("ses-idle")
    manager["tasks"].set(task.id, task)

    //#when
    await manager["pollRunningTasks"]()
    await manager.shutdown()

    //#then - positive terminal evidence (idle + valid output) allows completion
    expect(task.status).toBe("completed")
  })

  it("#given a child with a terminal 'deleted' status #when pollRunningTasks runs #then task completes", async () => {
    //#given - a registry terminal status is positive evidence the session ended
    const abort = mock(() => Promise.resolve({}))
    const manager = createManager({
      session: {
        status: async () => ({ data: { "ses-del": { type: "deleted" } } }),
        abort,
        get: mock(() => Promise.resolve({ data: { id: "ses-del" } })),
        prompt: async () => ({}),
        promptAsync: async () => ({}),
        todo: async () => ({ data: [] }),
        messages: async () => ({ data: [{ info: { role: "assistant", id: "m" }, parts: [{ type: "text", text: "done" }] }] }),
      },
    })
    const task = makeRunningTask("ses-del")
    manager["tasks"].set(task.id, task)

    //#when
    await manager["pollRunningTasks"]()
    await manager.shutdown()

    //#then - positive terminal evidence (deleted status) allows completion
    expect(task.status).toBe("completed")
  })
})
