/**
 * V2-fed in-memory todo registry.
 *
 * OpenCode V2 plugin ctx exposes no `session.todo()` API, so the V1 client
 * bridge degraded it to a logged no-op. The V2 runtime publishes a
 * `todo.updated` event carrying the full todo list for a session; this registry
 * captures those snapshots so the bridge can answer `session.todo()` with the
 * latest list. Deleted sessions are pruned.
 *
 * Pure in-memory: no I/O, no timers, no external dependencies.
 */

/** Todo shape consumed by tools/task/todo-sync.ts (V1 `session.todo` data). */
export type TodoItem = {
  id?: string
  content: string
  status: string
  priority?: string
}

export type TodoRegistry = {
  /**
   * Records a V2 todo lifecycle event for a session. `todo.updated` replaces the
   * stored list; `session.deleted` prunes the session; unknown kinds are
   * ignored.
   */
  feed(eventKind: string, sessionID: string, details?: { todos?: readonly TodoItem[] }): void
  /** Returns the latest todo list for a session, or undefined when untracked. */
  get(sessionID: string): TodoItem[] | undefined
  /** Returns the full sessionID -> todo list map. */
  map(): Record<string, TodoItem[]>
  /** Clears every tracked session. */
  clear(): void
}

/** V2 event kinds fed from event-hook-bridge.ts (exact names reused). */
const PRUNE_KIND = "session.deleted"
const UPDATE_KIND = "todo.updated"

export function createTodoRegistry(): TodoRegistry {
  const store = new Map<string, TodoItem[]>()

  return {
    feed(eventKind, sessionID, details) {
      if (eventKind === PRUNE_KIND) {
        store.delete(sessionID)
        return
      }
      if (eventKind !== UPDATE_KIND) return
      if (details?.todos === undefined) return
      store.set(sessionID, details.todos.map(copyTodo))
    },
    get(sessionID) {
      const todos = store.get(sessionID)
      return todos === undefined ? undefined : todos.map(copyTodo)
    },
    map() {
      const result: Record<string, TodoItem[]> = {}
      for (const [sessionID, todos] of store) {
        result[sessionID] = todos.map(copyTodo)
      }
      return result
    },
    clear() {
      store.clear()
    },
  }
}

/**
 * Narrows an untrusted V2 event payload into todo items, dropping malformed
 * entries. Returns undefined when the payload is not an array.
 */
export function toTodoItems(value: unknown): TodoItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  const items: TodoItem[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const content = entry["content"]
    const status = entry["status"]
    if (typeof content !== "string" || typeof status !== "string") continue
    const id = entry["id"]
    const priority = entry["priority"]
    items.push({
      ...(typeof id === "string" ? { id } : {}),
      content,
      status,
      ...(typeof priority === "string" ? { priority } : {}),
    })
  }
  return items
}

function copyTodo(todo: TodoItem): TodoItem {
  return {
    ...(todo.id !== undefined ? { id: todo.id } : {}),
    content: todo.content,
    status: todo.status,
    ...(todo.priority !== undefined ? { priority: todo.priority } : {}),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
