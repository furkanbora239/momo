import type { ToolContextWithMetadata, OpencodeClient } from "./types"
import type { SessionMessage } from "./executor-types"
import { getDefaultSyncPollTimeoutMs, getTimingConfig } from "./timing"
import { getTerminalSessionError, hasPendingToolPart, isSessionComplete } from "./sync-session-turns"
import { log } from "../../shared/logger"
import { normalizeSDKResponse } from "../../shared"

export { isSessionComplete } from "./sync-session-turns"

const ACTIVE_SESSION_STATUSES = new Set(["busy", "retry", "running"])
const CHILD_WAKE_GRACE_MS = 5_000

function wait(milliseconds: number): Promise<void> {
  const sharedBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT)
  const typedArray = new Int32Array(sharedBuffer)
  const result = Atomics.waitAsync(typedArray, 0, 0, milliseconds)
  return result.async ? result.value.then(() => undefined) : Promise.resolve()
}

function abortSyncSession(client: OpencodeClient, sessionID: string, reason: string): void {
  log("[task] Aborting sync session", { sessionID, reason })
  void client.session.abort({
    path: { id: sessionID },
  }).catch((error: unknown) => {
    log("[task] Failed to abort sync session", { sessionID, reason, error: String(error) })
  })
}

function isActiveSessionStatus(status: { type: string } | undefined): boolean {
  return status !== undefined && ACTIVE_SESSION_STATUSES.has(status.type)
}

async function fetchSessionMessages(
  client: OpencodeClient,
  sessionID: string
): Promise<SessionMessage[]> {
  const messagesResult = await client.session.messages({ path: { id: sessionID } })
  const rawData = (messagesResult as { data?: unknown })?.data ?? messagesResult
  return Array.isArray(rawData) ? (rawData as SessionMessage[]) : []
}

function computeActivitySignature(messages: SessionMessage[]): string {
  if (messages.length === 0) return "empty"
  const lastMsg = messages[messages.length - 1]
  const parts = (lastMsg?.parts ?? []) as Array<{
    type?: string
    text?: string
    tool?: string
    state?: { status?: string }
  }>
  let totalTextLen = 0
  let toolStatuses = ""
  for (const part of parts) {
    if (part.text) totalTextLen += part.text.length
    if (part.state?.status) toolStatuses += `:${part.tool ?? ""}-${part.state.status}`
  }
  return `${messages.length}:${parts.length}:${totalTextLen}:${toolStatuses}`
}

function findRunningTool(messages: SessionMessage[]): { tool: string; startedAt?: number } | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info?.role !== "assistant") continue
    const parts = (msg.parts ?? []) as Array<{
      type?: string
      tool?: string
      state?: { status?: string; time?: { start?: number } }
    }>
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j]
      if (part.type === "tool" && part.state?.status === "running") {
        return {
          tool: part.tool ?? "unknown",
          startedAt: part.state?.time?.start,
        }
      }
    }
  }
  return undefined
}

export function extractToolProgress(messages: SessionMessage[]): {
  toolCalls: number
  activeTool?: string
  lastTool?: string
} {
  let toolCalls = 0
  let activeTool: string | undefined
  let lastTool: string | undefined

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.info?.role !== "assistant") continue
    const parts = (msg.parts ?? []) as Array<{
      type?: string
      tool?: string
      state?: { status?: string; time?: { start?: number } }
    }>
    for (const part of parts) {
      if (part.type === "tool") {
        toolCalls++
        if (part.tool) {
          lastTool = part.tool
        }
        if (part.state?.status === "running" && part.tool) {
          activeTool = part.tool
        } else if (activeTool === part.tool && part.state?.status !== "running") {
          activeTool = undefined
        }
      }
    }
  }

  return { toolCalls, activeTool, lastTool }
}

const DEFAULT_MAX_ASSISTANT_TURNS = 300

export const SYNC_ABORT_REASONS = {
  user_cancel: "user_cancel",
  stall_detector: "stall_detector",
  max_turns: "max_turns",
  timeout: "timeout",
  provider_error: "provider_error",
  no_progress: "no_progress",
  mid_tool_incomplete: "mid_tool_incomplete",
} as const

export type SyncAbortReason = (typeof SYNC_ABORT_REASONS)[keyof typeof SYNC_ABORT_REASONS]

export type StallActivityInput = {
  stallElapsedMs: number
  producing: boolean
  hasRunningTool: boolean
  toolElapsedMs: number
  stallTimeoutMs: number
  productionTimeoutMs: number
  activeToolTimeoutMs: number
}

export type StallActivityDecision = {
  action: "continue" | "stall"
  reason: "producing" | "active_tool" | "stall_detector"
}

export function decideStallActivity(input: StallActivityInput): StallActivityDecision {
  if (input.hasRunningTool) {
    return input.toolElapsedMs >= input.activeToolTimeoutMs
      ? { action: "stall", reason: "stall_detector" }
      : { action: "continue", reason: "active_tool" }
  }
  if (input.producing) {
    return input.stallElapsedMs >= input.productionTimeoutMs
      ? { action: "stall", reason: "stall_detector" }
      : { action: "continue", reason: "producing" }
  }
  return input.stallElapsedMs >= input.stallTimeoutMs
    ? { action: "stall", reason: "stall_detector" }
    : { action: "continue", reason: "stall_detector" }
}

function hasAssistantText(messages: SessionMessage[]): boolean {
  return messages.some((m) => {
    if (m.info?.role !== "assistant") return false
    const parts = m.parts ?? []
    return parts.some((p) => {
      if (p.type !== "text" && p.type !== "reasoning") return false
      return (p.text ?? "").trim().length > 0
    })
  })
}

function isAssistantProducing(messages: SessionMessage[]): boolean {
  const lastAssistant = [...messages].reverse().find((m) => m.info?.role === "assistant")
  if (!lastAssistant) return false
  if (lastAssistant.info?.finish) return false
  return hasAssistantText([lastAssistant])
}

export async function pollSyncSession(
  ctx: ToolContextWithMetadata,
  client: OpencodeClient,
  input: {
    sessionID: string
    agentToUse: string
    toastManager: {
      removeTask: (id: string) => void
      updateTaskProgress?: (id: string, progress: { toolCalls?: number; lastTool?: string; activeTool?: string }) => void
    } | null | undefined
    taskId: string | undefined
    anchorMessageCount?: number
    maxAssistantTurns?: number
    hasActiveChildBackgroundTasks?: (sessionID: string) => boolean
    hasPendingParentWake?: (sessionID: string) => boolean
    childWakeGraceMs?: number
  },
  timeoutMs?: number
): Promise<string | null> {
  const syncTiming = getTimingConfig()
  const maxPollTimeMs = Math.max(timeoutMs ?? getDefaultSyncPollTimeoutMs(), 50)
  const maxTurns = input.maxAssistantTurns ?? DEFAULT_MAX_ASSISTANT_TURNS
  const pollStart = Date.now()
  let inactiveStart = pollStart
  let lastActivityAt = pollStart
  let lastActivitySig = ""
  let activeToolName: string | undefined
  let activeToolStartedAt: number | undefined
  let producingSinceAt: number | undefined
  let pollCount = 0
  let timedOut = false
  let assistantTurnCount = 0
  let lastSeenAssistantId: string | undefined
  let sawActiveAfterAnchor = false
  const childSettleMs = input.childWakeGraceMs ?? CHILD_WAKE_GRACE_MS
  let childWaitAssistantId: string | undefined
  let childSettleStartedAt = 0
  // A sync subagent can end its turn and then be re-woken by a parent-wake
  // notification once its background children finish. The task is only truly done
  // when no direct child work remains AND no wake is queued/in-flight for this
  // session. (Direct children only: a grandchild's completion wake is addressed to
  // its immediate parent, never to this session, so gating on grandchildren would
  // block on continuations this session can never receive.)
  // hasPendingParentWake bridges the notification dispatch window (debounce + queue +
  // promptAsync gate), which routinely exceeds a fixed grace; the settle window then
  // covers only the sub-second gap between a child reaching terminal status and the
  // wake being enqueued. Once a new turn appears the assistant id changes and we stop
  // waiting to evaluate it. The outer inactivity timeout remains the safety bound.
  const isAwaitingChildContinuation = (currentAssistantId: string | undefined): boolean => {
    const continuationOwed =
      (input.hasActiveChildBackgroundTasks?.(input.sessionID) ?? false) ||
      (input.hasPendingParentWake?.(input.sessionID) ?? false)
    if (continuationOwed) {
      childWaitAssistantId = currentAssistantId
      childSettleStartedAt = 0
      return true
    }
    if (childWaitAssistantId === undefined || currentAssistantId !== childWaitAssistantId) {
      return false
    }
    childSettleStartedAt ||= Date.now()
    return Date.now() - childSettleStartedAt < childSettleMs
  }

  log("[task] Starting poll loop", { sessionID: input.sessionID, agentToUse: input.agentToUse, maxTurns })

  while (true) {
    const loopNow = Date.now()
    const inactiveElapsedMs = loopNow - inactiveStart
    if (inactiveElapsedMs >= maxPollTimeMs) {
      timedOut = true
      break
    }

    if (ctx.abort?.aborted) {
      let finalMessages: SessionMessage[] | null = null
      const abortFetchAttempts = 3
      for (let attempt = 1; attempt <= abortFetchAttempts; attempt++) {
        try {
          finalMessages = await fetchSessionMessages(client, input.sessionID)
          break
        } catch (error) {
          const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
          log("[task] Final messages fetch failed after abort, retrying", {
            sessionID: input.sessionID,
            attempt,
            maxAttempts: abortFetchAttempts,
            error: errorMessage,
          })
          if (attempt < abortFetchAttempts) {
            await wait(syncTiming.POLL_INTERVAL_MS)
          }
        }
      }

      if (finalMessages) {
        const hasNewMessages =
          input.anchorMessageCount === undefined || finalMessages.length > input.anchorMessageCount
        if (hasNewMessages && isSessionComplete(finalMessages)) {
          log("[task] Abort detected after session already completed", { sessionID: input.sessionID })
          return null
        }
      }

      log("[task] Aborted by user", { sessionID: input.sessionID })
      abortSyncSession(client, input.sessionID, SYNC_ABORT_REASONS.user_cancel)
      if (input.toastManager && input.taskId) input.toastManager.removeTask(input.taskId)
      return `Task aborted (reason: ${SYNC_ABORT_REASONS.user_cancel}).\n\nSession ID: ${input.sessionID}`
    }

    await wait(syncTiming.POLL_INTERVAL_MS)
    pollCount++

    let sessionStatus: { type: string } | undefined
    try {
      const statusResult = await client.session.status()
      const allStatuses = normalizeSDKResponse(statusResult, {} as Record<string, { type: string }>)
      sessionStatus = allStatuses[input.sessionID]
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      log("[task] Poll status fetch failed, checking messages", { sessionID: input.sessionID, error: errorMessage })
    }

    if (pollCount % 10 === 0) {
      log("[task] Poll status", {
        sessionID: input.sessionID,
        pollCount,
        elapsed: Math.floor((Date.now() - pollStart) / 1000) + "s",
        inactiveElapsed: Math.floor(inactiveElapsedMs / 1000) + "s",
        sessionStatus: sessionStatus?.type ?? "not_in_status",
      })
    }

    if (isActiveSessionStatus(sessionStatus)) {
      sawActiveAfterAnchor = true
      const stallElapsed = loopNow - lastActivityAt
      if (pollCount % 3 === 0 || stallElapsed >= syncTiming.STALL_TIMEOUT_MS) {
        let activeMessages: SessionMessage[] = []
        try {
          activeMessages = await fetchSessionMessages(client, input.sessionID)
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error)
          log("[task] Poll active messages fetch failed, continuing", { sessionID: input.sessionID, error: errorMessage })
        }

        if (activeMessages.length > 0) {
          if (input.toastManager && input.taskId) {
            const progress = extractToolProgress(activeMessages)
            input.toastManager.updateTaskProgress?.(input.taskId, progress)
          }

          const currentSig = computeActivitySignature(activeMessages)
          if (currentSig !== lastActivitySig) {
            lastActivitySig = currentSig
            lastActivityAt = loopNow
            inactiveStart = loopNow
            producingSinceAt = undefined
            continue
          }
        }

        const runningTool = findRunningTool(activeMessages)
        if (runningTool && activeToolName !== runningTool.tool) {
          activeToolName = runningTool.tool
          activeToolStartedAt = runningTool.startedAt ?? loopNow
        }
        if (!runningTool) {
          activeToolName = undefined
          activeToolStartedAt = undefined
        }
        const toolElapsed = loopNow - (activeToolStartedAt ?? loopNow)
        const producing = isAssistantProducing(activeMessages)
        if (producing) {
          producingSinceAt ??= loopNow
        } else {
          producingSinceAt = undefined
        }
        const decisionStallElapsed = producing
          ? loopNow - (producingSinceAt ?? loopNow)
          : stallElapsed
        const decision = decideStallActivity({
          stallElapsedMs: decisionStallElapsed,
          producing,
          hasRunningTool: runningTool !== undefined,
          toolElapsedMs: toolElapsed,
          stallTimeoutMs: syncTiming.STALL_TIMEOUT_MS,
          productionTimeoutMs: syncTiming.PRODUCTION_TIMEOUT_MS,
          activeToolTimeoutMs: syncTiming.ACTIVE_TOOL_TIMEOUT_MS,
        })
        if (decision.action === "continue") {
          inactiveStart = loopNow
          if (decision.reason === "producing" || decision.reason === "active_tool") {
            lastActivityAt = loopNow
          }
          continue
        }

        const stallMinutes = Math.max(1, Math.round(decisionStallElapsed / 60000))
        log("[task] Poll stall detected: session busy with no activity and no active tool", {
          sessionID: input.sessionID,
          stallElapsed: decisionStallElapsed,
          stallTimeoutMs: syncTiming.STALL_TIMEOUT_MS,
          productionTimeoutMs: syncTiming.PRODUCTION_TIMEOUT_MS,
          producing,
        })
        abortSyncSession(client, input.sessionID, SYNC_ABORT_REASONS.stall_detector)
        if (input.toastManager && input.taskId) input.toastManager.removeTask(input.taskId)
        return `Task aborted (reason: ${SYNC_ABORT_REASONS.stall_detector}): subagent stalled (no activity for ${stallMinutes}min while session was busy with no active tool). Session ID: ${input.sessionID}`
      }

      inactiveStart = loopNow
      continue
    }

    let messages: SessionMessage[]
    try {
      messages = await fetchSessionMessages(client, input.sessionID)
    } catch (error) {
      const errorMessage = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      log("[task] Poll messages fetch failed, retrying", { sessionID: input.sessionID, error: errorMessage })
      continue
    }

    if (messages.length > 0) {
      const currentSig = computeActivitySignature(messages)
      if (currentSig !== lastActivitySig) {
        lastActivitySig = currentSig
        lastActivityAt = Date.now()
      }
      if (input.toastManager && input.taskId) {
        const progress = extractToolProgress(messages)
        input.toastManager.updateTaskProgress?.(input.taskId, progress)
      }
    }

    if (input.anchorMessageCount !== undefined && messages.length <= input.anchorMessageCount) {
      continue
    }

    // Continuation-aware slice: terminal/error/turn checks must only see
    // messages produced after the resume prompt, not pre-anchor turns.
    const relevantMessages =
      input.anchorMessageCount !== undefined ? messages.slice(input.anchorMessageCount) : messages

    // Pre-anchor turns make the session report completion while the resumed
    // session produced no new assistant turn. That completion is stale:
    // surface no_progress so the caller retries with a fresh session. The
    // sawActiveAfterAnchor gate prevents a fast-fail when the resume prompt
    // has not produced a busy status yet and the turn has simply not started.
    if (
      input.anchorMessageCount !== undefined &&
      sawActiveAfterAnchor &&
      isSessionComplete(messages) &&
      !relevantMessages.some((m) => m.info?.role === "assistant")
    ) {
      log("[task] Continuation made no progress", { sessionID: input.sessionID, pollCount })
      return `Task produced no new work (reason: ${SYNC_ABORT_REASONS.no_progress}). The session may be exhausted or poisoned; retry with a fresh session instead of reusing this task id. Session ID: ${input.sessionID}`
    }

    const sessionError = getTerminalSessionError(relevantMessages)
    if (sessionError) {
      log("[task] Poll detected terminal session error", { sessionID: input.sessionID, sessionError })
      return `Task aborted (reason: ${SYNC_ABORT_REASONS.provider_error}): ${sessionError}`
    }

    if (isSessionComplete(relevantMessages)) {
      const currentAssistantId = [...relevantMessages].reverse().find((m) => m.info?.role === "assistant")?.info?.id
      if (isAwaitingChildContinuation(currentAssistantId)) {
        continue
      }
      log("[task] Poll complete - terminal finish detected", { sessionID: input.sessionID, pollCount })
      break
    }

    // Count new assistant turns to circuit-break infinite loops
    const lastAssistant = [...relevantMessages].reverse().find((m) => m.info?.role === "assistant")
    if (lastAssistant?.info?.id && lastAssistant.info.id !== lastSeenAssistantId) {
      lastSeenAssistantId = lastAssistant.info.id
      assistantTurnCount++
      if (assistantTurnCount >= maxTurns) {
        log("[task] Max assistant turns reached, aborting to prevent infinite loop", {
          sessionID: input.sessionID,
          assistantTurnCount,
          maxTurns,
        })
        abortSyncSession(client, input.sessionID, SYNC_ABORT_REASONS.max_turns)
        if (input.toastManager && input.taskId) input.toastManager.removeTask(input.taskId)
        return `Task aborted (reason: ${SYNC_ABORT_REASONS.max_turns}): subagent exceeded ${maxTurns} assistant turns without completing. This usually indicates an infinite tool-call loop. Session ID: ${input.sessionID}`
      }
    }

    const hasAssistantTextNow = hasAssistantText(relevantMessages)

    if (!lastAssistant?.info?.finish && hasAssistantTextNow) {
      // A pending tool part means the text is a mid-work thought, not a
      // deliverable: the worker was stopped mid-tool. Never report completion.
      if (lastAssistant !== undefined && hasPendingToolPart(lastAssistant)) {
        log("[task] Poll stopped: assistant text present but a tool part is still pending", {
          sessionID: input.sessionID,
          pollCount,
        })
        return `Task incomplete (reason: ${SYNC_ABORT_REASONS.mid_tool_incomplete}): the subagent emitted text while a tool call was still pending, so the result is not a finished deliverable. Resume the task with task_id instead of treating this as completion. Session ID: ${input.sessionID}`
      }
      if (isAwaitingChildContinuation(lastAssistant?.info?.id)) {
        continue
      }
      log("[task] Poll complete - assistant text detected (fallback)", {
        sessionID: input.sessionID,
        pollCount,
      })
      break
    }
  }

  if (timedOut) {
    log("[task] Poll inactivity timeout reached", { sessionID: input.sessionID, pollCount })
    abortSyncSession(client, input.sessionID, SYNC_ABORT_REASONS.timeout)
  }

  return timedOut
    ? `Poll inactivity timeout reached after ${maxPollTimeMs}ms without active OpenCode status for session ${input.sessionID} (reason: ${SYNC_ABORT_REASONS.timeout})`
    : null
}
