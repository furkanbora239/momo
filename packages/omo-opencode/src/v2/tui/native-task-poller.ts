import { readNativeTaskRows, type NativeTaskView } from "./native-task-view"

export type NativeTaskPollerInput = {
  read: (rootSessionID: string, signal: AbortSignal) => Promise<unknown>
  update: (view: NativeTaskView) => void
  intervalMs?: number
  timeoutMs?: number
}

/** One mounted view owns this poller. Scope changes abort and invalidate old reads. */
export function createNativeTaskPoller(input: NativeTaskPollerInput) {
  let disposed = false
  let generation = 0
  let root: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let controller: AbortController | undefined
  let view: NativeTaskView = { status: "loading", rows: [] }

  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    controller?.abort()
    controller = undefined
  }
  const poll = async (scope: string, version: number): Promise<void> => {
    if (disposed || version !== generation) return
    const request = new AbortController()
    controller = request
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      const output = await Promise.race([
        input.read(scope, request.signal),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            request.abort()
            reject(new Error("Native task status timed out"))
          }, input.timeoutMs ?? 5000)
          request.signal.addEventListener("abort", () => reject(new Error("Native task status aborted")), { once: true })
        }),
      ])
      const rows = readNativeTaskRows(output, scope)
      if (disposed || version !== generation) return
      view = { status: "ready", rows }
      input.update(view)
    } catch {
      if (disposed || version !== generation) return
      view = { status: view.status === "ready" || view.status === "stale" ? "stale" : "unavailable", rows: view.rows }
      input.update(view)
    } finally {
      if (timeout !== undefined) clearTimeout(timeout)
      if (controller === request) controller = undefined
      if (!disposed && version === generation) timer = setTimeout(() => void poll(scope, version), input.intervalMs ?? 1500)
    }
  }
  return {
    setScope(scope: string | undefined) {
      if (disposed || scope === root) return
      cancel()
      root = scope
      const version = ++generation
      view = { status: "loading", rows: [] }
      input.update(view)
      if (scope) void poll(scope, version)
    },
    dispose() {
      disposed = true
      ++generation
      cancel()
    },
  }
}
