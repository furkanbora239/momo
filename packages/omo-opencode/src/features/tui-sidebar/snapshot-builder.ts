import { getLastAgentFromSession } from "../../hooks/atlas/session-last-agent"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { getTaskToastManager } from "../task-toast-manager"
import type { TrackedTask } from "../task-toast-manager/types"
import { MIRROR_SCHEMA_VERSION } from "./constants"
import { readActiveLoop } from "./loop-reader"
import { canonicalProjectDir } from "./mirror-path"
import type { TuiRuntimeSnapshot } from "./snapshot-schema"
import type { AgentStatus, JobRow } from "./state-types"
import type { BackgroundTaskSnapshot } from "../background-agent/types"

export type TuiMirrorClient = {
  readonly session: {
    readonly status: () => Promise<unknown>
    readonly messages: (input: { readonly path: { readonly id: string } }) => Promise<unknown>
  }
}

export type SessionStatusRow = {
  readonly type: string
}

export type SessionStatusMap = Record<string, SessionStatusRow>

export type TuiBackgroundSnapshotProvider = {
  readonly getTasksSnapshot: () => readonly BackgroundTaskSnapshot[]
}

export type TuiTaskToastSnapshotProvider = {
  readonly getRunningTasks: () => readonly TrackedTask[]
}

export type SessionAgentResolver = (sessionID: string, client: TuiMirrorClient) => Promise<string | null>

export type BuildTuiRuntimeSnapshotInput = {
  readonly client: TuiMirrorClient
  readonly projectDir: string
  readonly backgroundManager: TuiBackgroundSnapshotProvider
  readonly getStatuses?: () => Promise<SessionStatusMap>
  readonly sessionAgentResolver?: SessionAgentResolver
  readonly taskToastManager?: TuiTaskToastSnapshotProvider | null
}

type ActiveAgentStatus = Extract<AgentStatus, "busy" | "retry" | "running">

export async function buildTuiRuntimeSnapshot(
  input: BuildTuiRuntimeSnapshotInput,
): Promise<TuiRuntimeSnapshot> {
  const statuses = await readStatuses(input)
  const loop = readActiveLoop(input.projectDir)

  const resolvedActiveAgents = await activeAgentsFromStatuses(
    statuses,
    input.client,
    input.sessionAgentResolver ?? getLastAgentFromSession,
  )

  const toastManager = input.taskToastManager !== undefined ? input.taskToastManager : getTaskToastManager()
  const runningToastTasks = toastManager?.getRunningTasks() ?? []

  const activeAgentNames = new Set(resolvedActiveAgents.map((a) => a.name.toLowerCase()))
  const extraActiveAgents: Array<{ name: string; status: ActiveAgentStatus }> = []

  for (const task of runningToastTasks) {
    if (task.agent && !activeAgentNames.has(task.agent.toLowerCase())) {
      activeAgentNames.add(task.agent.toLowerCase())
      extraActiveAgents.push({
        name: task.agent,
        status: "running",
      })
    }
  }

  const bgSnapshots = input.backgroundManager.getTasksSnapshot()
  for (const task of bgSnapshots) {
    if (task.status === "running" && task.agent && !activeAgentNames.has(task.agent.toLowerCase())) {
      activeAgentNames.add(task.agent.toLowerCase())
      extraActiveAgents.push({
        name: task.agent,
        status: "running",
      })
    }
  }

  const bgJobs = bgSnapshots.map(toJobRow)

  const syncJobs: JobRow[] = []
  for (const task of runningToastTasks) {
    if (!task.isBackground) {
      const activeTool = task.activeTool
      const lastTool = activeTool ? `[Running: ${activeTool}]` : (task.lastTool ?? null)
      syncJobs.push({
        title: task.description || `${task.agent} task`,
        status: "running",
        toolCalls: task.toolCalls ?? null,
        lastTool,
      })
    }
  }

  return {
    version: MIRROR_SCHEMA_VERSION,
    projectDir: canonicalProjectDir(input.projectDir),
    updatedAt: Date.now(),
    activeAgents: [...resolvedActiveAgents, ...extraActiveAgents],
    jobBoard: [...bgJobs, ...syncJobs],
    loop: loop.kind === "live" ? redactLoopText(loop) : null,
  }
}

async function readStatuses(input: BuildTuiRuntimeSnapshotInput): Promise<SessionStatusMap> {
  if (input.getStatuses) {
    return input.getStatuses()
  }

  const response = await input.client.session.status()
  return normalizeSDKResponse<SessionStatusMap>(response, {})
}

async function activeAgentsFromStatuses(
  statuses: SessionStatusMap,
  client: TuiMirrorClient,
  sessionAgentResolver: SessionAgentResolver,
): Promise<TuiRuntimeSnapshot["activeAgents"]> {
  const rows = Object.entries(statuses)
    .map(([sessionID, row]) => ({ sessionID, status: activeStatus(row.type) }))
    .filter((row): row is { readonly sessionID: string; readonly status: ActiveAgentStatus } => row.status !== null)

  return Promise.all(
    rows.map(async (row) => ({
      name: (await sessionAgentResolver(row.sessionID, client)) ?? row.sessionID,
      status: row.status,
    })),
  )
}

function activeStatus(status: string): ActiveAgentStatus | null {
  switch (status) {
    case "busy":
    case "retry":
    case "running":
      return status
    default:
      return null
  }
}

function toJobRow(task: BackgroundTaskSnapshot): JobRow {
  return {
    title: task.title || `${task.agent} background task`,
    status: task.status,
    toolCalls: task.toolCalls,
    lastTool: task.lastTool,
  }
}

function redactLoopText(loop: TuiRuntimeSnapshot["loop"]): TuiRuntimeSnapshot["loop"] {
  if (loop === null) {
    return null
  }
  return { ...loop, activeGoal: null }
}
