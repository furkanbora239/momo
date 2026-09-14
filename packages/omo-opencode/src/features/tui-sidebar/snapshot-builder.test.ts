import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { LOOP_FRESH_MS } from "./constants"
import { buildTuiRuntimeSnapshot } from "./snapshot-builder"
import { TuiRuntimeSnapshotSchema } from "./snapshot-schema"
import type { SessionAgentResolver } from "./snapshot-builder"
import type { BackgroundTaskSnapshot } from "../background-agent/types"

type StatusRow = { readonly type: string }
type StatusMap = Record<string, StatusRow>

type FakeClient = {
  readonly session: {
    readonly status: () => Promise<{ readonly data: StatusMap }>
    readonly messages: (input: { readonly path: { readonly id: string } }) => Promise<unknown>
  }
}

type FakeBackgroundManager = {
  readonly getTasksSnapshot: () => readonly BackgroundTaskSnapshot[]
}

const tempDirs: string[] = []

function makeTempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `omo-tui-snapshot-builder-${label}-`))
  tempDirs.push(dir)
  return dir
}

function writeLiveLoop(projectDir: string): void {
  const filePath = join(projectDir, ".omo", "ulw-loop", "current", "goals.json")
  mkdirSync(join(filePath, ".."), { recursive: true })
  writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      activeGoalId: "ship",
      goals: [
        {
          id: "ship",
          title: "Ship mirror",
          status: "in_progress",
          successCriteria: [{ status: "pass" }, { status: "fail" }],
        },
      ],
    }),
  )
}

function writeSensitiveLiveLoop(projectDir: string): void {
  const filePath = join(projectDir, ".omo", "ulw-loop", "current", "goals.json")
  mkdirSync(join(filePath, ".."), { recursive: true })
  writeFileSync(
    filePath,
    JSON.stringify({
      version: 1,
      activeGoalId: "secret",
      goals: [
        {
          id: "secret",
          title: "Deploy with token sk-live-secret",
          status: "in_progress",
          successCriteria: [{ status: "pending" }],
        },
      ],
    }),
  )
}

function createClient(statuses: StatusMap): FakeClient {
  return {
    session: {
      status: async () => ({ data: statuses }),
      messages: async () => ({ data: [] }),
    },
  }
}

function createBackgroundManager(tasks: readonly BackgroundTaskSnapshot[]): FakeBackgroundManager {
  return {
    getTasksSnapshot: () => tasks,
  }
}

const resolveTestSessionAgent: SessionAgentResolver = async (sessionID) => {
  switch (sessionID) {
    case "ses-main":
      return "sisyphus"
    case "ses-sub":
      return "atlas"
    default:
      return null
  }
}

describe("buildTuiRuntimeSnapshot", () => {
  beforeEach(() => {
    makeTempDir("isolation")
  })

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("#given SDK data statuses background jobs and a live loop #when building #then it returns a schema-valid runtime snapshot", async () => {
    // given
    const projectDir = makeTempDir("schema-project")
    writeLiveLoop(projectDir)

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client: createClient({
        "ses-main": { type: "busy" },
        "ses-idle": { type: "idle" },
        "ses-sub": { type: "retry" },
      }),
      backgroundManager: createBackgroundManager([
        {
          title: "Explore runtime",
          status: "running",
          toolCalls: 3,
          lastTool: "grep",
          agent: "sisyphus",
        },
      ]),
      sessionAgentResolver: resolveTestSessionAgent,
    })

    // then
    expect(TuiRuntimeSnapshotSchema.safeParse(snapshot).success).toBe(true)
    expect(snapshot.projectDir).toBe(realpathSync.native(resolve(projectDir)))
    expect(snapshot.activeAgents).toEqual([
      { name: "sisyphus", status: "busy" },
      { name: "atlas", status: "retry" },
    ])
    expect(snapshot.jobBoard).toEqual([
      { title: "Explore runtime", status: "running", toolCalls: 3, lastTool: "grep", agent: "sisyphus" },
    ])
    expect(snapshot.loop).toEqual({
      kind: "live",
      goalsDone: 0,
      goalsTotal: 1,
      pass: 1,
      fail: 1,
      pending: 0,
      blocked: 0,
      activeGoal: null,
    })
    expect(Date.now() - snapshot.updatedAt).toBeLessThan(LOOP_FRESH_MS)
  })

  it("#given no session agent is available #when building #then it uses the session id fallback explicitly", async () => {
    // given
    const projectDir = makeTempDir("fallback-project")

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client: {
        session: {
          status: async () => ({ data: { "ses-fallback": { type: "running" } } }),
          messages: async () => ({ data: [] }),
        },
      },
      backgroundManager: createBackgroundManager([]),
    })

    // then
    expect(snapshot.activeAgents).toEqual([{ name: "ses-fallback", status: "running" }])
  })

  it("#given prompt-derived task and loop titles #when building #then persisted mirror text is redacted", async () => {
    // given
    const projectDir = makeTempDir("sensitive-text")
    writeSensitiveLiveLoop(projectDir)

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client: createClient({}),
      backgroundManager: createBackgroundManager([
        {
          title: "atlas background task",
          status: "running",
          toolCalls: 1,
          lastTool: "read",
          agent: "atlas",
        },
      ]),
      sessionAgentResolver: resolveTestSessionAgent,
    })

    // then
    expect(snapshot.loop?.activeGoal).toBeNull()
    expect(snapshot.jobBoard).toEqual([
      { title: "atlas background task", status: "running", toolCalls: 1, lastTool: "read", agent: "atlas" },
    ])
    expect(JSON.stringify(snapshot)).not.toContain("sk-live")
  })

  it("#given synchronous task in taskToastManager #when building #then it includes sync tasks in jobBoard and agents in activeAgents", async () => {
    // given
    const projectDir = makeTempDir("sync-tasks-project")

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client: createClient({}),
      backgroundManager: createBackgroundManager([]),
      taskToastManager: {
        getRunningTasks: () => [
          {
            id: "sync_12345678",
            description: "Run unit tests",
            agent: "worker",
            status: "running",
            startedAt: new Date(),
            isBackground: false,
            toolCalls: 4,
            activeTool: "bash",
            lastTool: "read_file",
          },
        ],
      },
    })

    // then
    expect(snapshot.activeAgents).toEqual([
      { name: "worker", status: "running" },
    ])
    expect(snapshot.jobBoard).toEqual([
      {
        title: "Run unit tests",
        status: "running",
        toolCalls: 4,
        lastTool: "[Running: bash]",
        agent: "worker",
      },
    ])
  })

  it("#given an enriched background snapshot #when building #then it carries session model prompt and parent fields into job rows", async () => {
    // given
    const projectDir = makeTempDir("enriched-bg-project")

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client: createClient({}),
      backgroundManager: createBackgroundManager([
        {
          title: "Index repository",
          status: "running",
          toolCalls: 2,
          lastTool: "read",
          agent: "explore",
          sessionId: "ses-child",
          parentSessionId: "ses-main",
          modelID: "google/gemini-2.5-flash",
          activeTool: "grep",
          startedAt: 1_718_000_000_000,
        },
      ]),
    })

    // then
    expect(snapshot.jobBoard).toEqual([
      {
        title: "Index repository",
        status: "running",
        toolCalls: 2,
        lastTool: "read",
        agent: "explore",
        sessionId: "ses-child",
        parentSessionId: "ses-main",
        model: "google/gemini-2.5-flash",
        startedAt: 1_718_000_000_000,
      },
    ])
  })

  it("#given a queued synchronous task #when building #then it appears as a pending job row", async () => {
    // given
    const projectDir = makeTempDir("queued-sync-project")

    // when
    const snapshot = await buildTuiRuntimeSnapshot({
      projectDir,
      client: createClient({}),
      backgroundManager: createBackgroundManager([]),
      taskToastManager: {
        getRunningTasks: () => [],
        getQueuedTasks: () => [
          {
            id: "sync_queued_1",
            description: "Deploy staging",
            agent: "worker",
            status: "queued",
            startedAt: new Date(),
            isBackground: false,
            sessionID: "ses-queued",
            modelInfo: { model: "openai/gpt-5.6-flash", type: "category-default" },
          },
        ],
      },
    })

    // then
    expect(snapshot.activeAgents).toEqual([])
    expect(snapshot.jobBoard).toEqual([
      {
        title: "Deploy staging",
        status: "pending",
        toolCalls: null,
        lastTool: null,
        agent: "worker",
        sessionId: "ses-queued",
        model: "openai/gpt-5.6-flash",
      },
    ])
  })
})
