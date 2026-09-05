import type { ToolContextWithMetadata, OpencodeClient } from "./types"
import type { SessionMessage } from "./executor-types"
import { getDefaultSyncPollTimeoutMs, getTimingConfig } from "./timing"
import { getTerminalSessionError, isSessionComplete } from "./sync-session-turns"
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
  let pollCount = 0
  let timedOut = false
  let assistantTurnCount = 0
  let lastSeenAssistantId: string | undefined
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
      abortSyncSession(client, input.sessionID, "parent_abort")
      if (input.toastManager && input.taskId) input.toastManager.removeTask(input.taskId)
      return `Task aborted.\n\nSession ID: ${input.sessionID}`
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
            continue
          }
        }

        const runningTool = findRunningTool(activeMessages)
        if (runningTool) {
          if (activeToolName !== runningTool.tool) {
            activeToolName = runningTool.tool
            activeToolStartedAt = runningTool.startedAt ?? loopNow
          }
          const toolElapsed = loopNow - (activeToolStartedAt ?? loopNow)
          if (toolElapsed < syncTiming.ACTIVE_TOOL_TIMEOUT_MS) {
            lastActivityAt = loopNow
            inactiveStart = loopNow
            continue
          }
        } else {
          activeToolName = undefined
          activeToolStartedAt = undefined
        }

        if (stallElapsed >= syncTiming.STALL_TIMEOUT_MS) {
          const stallMinutes = Math.max(1, Math.round(stallElapsed / 60000))
          log("[task] Poll stall detected: session busy with no activity and no active tool", {
            sessionID: input.sessionID,
            stallElapsed,
            stallTimeoutMs: syncTiming.STALL_TIMEOUT_MS,
          })
          abortSyncSession(client, input.sessionID, "stalled_no_activity")
          if (input.toastManager && input.taskId) input.toastManager.removeTask(input.taskId)
          return `Task aborted: subagent stalled (no activity for ${stallMinutes}min while session was busy with no active tool). Session ID: ${input.sessionID}`
        }
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

    const sessionError = getTerminalSessionError(messages)
    if (sessionError) {
      log("[task] Poll detected terminal session error", { sessionID: input.sessionID, sessionError })
      return sessionError
    }

    if (isSessionComplete(messages)) {
      const currentAssistantId = [...messages].reverse().find((m) => m.info?.role === "assistant")?.info?.id
      if (isAwaitingChildContinuation(currentAssistantId)) {
        continue
      }
      log("[task] Poll complete - terminal finish detected", { sessionID: input.sessionID, pollCount })
      break
    }

    // Count new assistant turns to circuit-break infinite loops
    const lastAssistant = [...messages].reverse().find((m) => m.info?.role === "assistant")
    if (lastAssistant?.info?.id && lastAssistant.info.id !== lastSeenAssistantId) {
      lastSeenAssistantId = lastAssistant.info.id
      assistantTurnCount++
      if (assistantTurnCount >= maxTurns) {
        log("[task] Max assistant turns reached, aborting to prevent infinite loop", {
          sessionID: input.sessionID,
          assistantTurnCount,
          maxTurns,
        })
        abortSyncSession(client, input.sessionID, "max_turns_exceeded")
        if (input.toastManager && input.taskId) input.toastManager.removeTask(input.taskId)
        return `Task aborted: subagent exceeded ${maxTurns} assistant turns without completing. This usually indicates an infinite tool-call loop. Session ID: ${input.sessionID}`
      }
    }

    const hasAssistantText = messages.some((m) => {
      if (m.info?.role !== "assistant") return false
      const parts = m.parts ?? []
      return parts.some((p) => {
        if (p.type !== "text" && p.type !== "reasoning") return false
        const text = (p.text ?? "").trim()
        return text.length > 0
      })
    })

    if (!lastAssistant?.info?.finish && hasAssistantText) {
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
    abortSyncSession(client, input.sessionID, "poll_timeout")
  }

  return timedOut
    ? `Poll inactivity timeout reached after ${maxPollTimeMs}ms without active OpenCode status for session ${input.sessionID}`
    : null
}
