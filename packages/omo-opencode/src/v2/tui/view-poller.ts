export type ViewPollerInput<View> = {
  readonly directory: string
  readonly intervalMs: number
  readonly initialKey: string
  readonly readView: (directory: string) => Promise<View>
  readonly viewKeyOf: (view: View) => string
  readonly onViewChanged: (view: View) => void
  readonly onError: (error: Error) => void
}

export type ViewPoller = {
  readonly start: () => void
  readonly tick: () => Promise<void>
  readonly dispose: () => void
}

/**
 * The V1 tui.ts sidebar poll loop, extracted: poll readView on an interval,
 * re-render only when the view key changes, never overlap in-flight reads,
 * and stop cleanly on dispose. Non-Error throws propagate like the V1
 * handleTuiPollError contract.
 */
export function createViewPoller<View>(input: ViewPollerInput<View>): ViewPoller {
  let currentKey = input.initialKey
  let disposed = false
  let inFlight = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const schedule = (): void => {
    timer = setTimeout(tick, input.intervalMs)
  }

  const tick = async (): Promise<void> => {
    if (disposed || inFlight) {
      if (!disposed) schedule()
      return
    }
    inFlight = true
    try {
      const nextView = await input.readView(input.directory)
      const nextKey = input.viewKeyOf(nextView)
      if (nextKey !== currentKey) {
        currentKey = nextKey
        input.onViewChanged(nextView)
      }
    } catch (error) {
      if (error instanceof Error) {
        input.onError(error)
      } else {
        throw error
      }
    } finally {
      inFlight = false
      if (!disposed) schedule()
    }
  }

  return {
    start: () => {
      if (disposed || timer !== null) return
      schedule()
    },
    tick,
    dispose: () => {
      disposed = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
