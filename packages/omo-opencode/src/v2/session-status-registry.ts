/**
 * V2-fed in-memory session-status registry.
 *
 * OpenCode V2 plugin ctx exposes no `session.status()` API, so the V1 client
 * bridge degraded it to a logged no-op. The background-agent poller relies on a
 * status registry to judge child sessions, so this registry reconstructs status
 * from the V2 session lifecycle events already flowing through the event-hook
 * bridge (`ctx.event.subscribe`) and serves as the bridge's `session.status`
 * source.
 *
 * Pure in-memory: no I/O, no timers, no external dependencies.
 */

export type SessionStatusType = string

/** Status shape consumed by features/background-agent/session-status-classifier.ts. */
export type SessionStatusResult = { type: SessionStatusType }

/** Internal record carrying the verbatim status plus the last-seen timestamp. */
type SessionStatusEntry = {
  type: SessionStatusType
  timestamp: number
}

export type SessionStatusRegistry = {
  /**
   * Records a V2 session event for a session. Recognized lifecycle kinds set or
   * prune status; unknown kinds with no explicit status are ignored. Deleted
   * sessions are pruned from the registry entirely.
   */
  feed(eventKind: string, sessionID: string, details?: { status?: string }): void
  /** Returns the latest status for a session, or undefined when untracked. */
  get(sessionID: string): SessionStatusResult | undefined
  /** Returns the full sessionID -> status map. */
  map(): Record<string, SessionStatusResult>
  /** Clears every tracked session. */
  clear(): void
}

/** V2 session event kinds fed from event-hook-bridge.ts (exact names reused). */
const PRUNE_KIND = "session.deleted"

export function createSessionStatusRegistry(): SessionStatusRegistry {
  const store = new Map<string, SessionStatusEntry>()

  return {
    feed(eventKind, sessionID, details) {
      if (eventKind === PRUNE_KIND) {
        store.delete(sessionID)
        return
      }
      const type = deriveStatusType(eventKind, details)
      if (type === undefined) return
      store.set(sessionID, { type, timestamp: Date.now() })
    },
    get(sessionID) {
      const entry = store.get(sessionID)
      return entry === undefined ? undefined : { type: entry.type }
    },
    map() {
      const result: Record<string, SessionStatusResult> = {}
      for (const [sessionID, entry] of store) {
        result[sessionID] = { type: entry.type }
      }
      return result
    },
    clear() {
      store.clear()
    },
  }
}

/**
 * Maps a V2 session event kind to a status type. Returns undefined for kinds
 * that should not create or update a status entry (unknown kinds without an
 * explicit status).
 */
function deriveStatusType(eventKind: string, details?: { status?: string }): SessionStatusType | undefined {
  switch (eventKind) {
    case "session.idle":
      return "idle"
    case "session.status":
      return details?.status ?? "alive"
    case "session.created":
      return "alive"
    case "session.execution.failed":
    case "session.step.failed":
      return details?.status ?? "error"
    case "session.compaction.ended":
      return "idle"
    default:
      return details?.status
  }
}
