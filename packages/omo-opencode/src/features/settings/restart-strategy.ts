export const SESSION_NEW_COMMAND = "session.new"

export const RESTART_FALLBACK_MESSAGE = "settings written - open a new session to apply"

export type RestartAction =
  | { readonly kind: "dispatched" }
  | { readonly kind: "fallback" }

export type RestartKeymap = {
  readonly dispatchCommand?: (command: string) => unknown
}

export type RestartDispatcher = (
  keymap: RestartKeymap,
  command: string,
) => unknown

const FALLBACK: RestartAction = { kind: "fallback" }
const DISPATCHED: RestartAction = { kind: "dispatched" }

export const defaultRestartDispatcher: RestartDispatcher = (keymap, command) =>
  keymap.dispatchCommand?.(command)

function isThenable(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  )
}

function isFailedResult(result: unknown): boolean {
  if (result === undefined) return true
  if (typeof result === "object" && result !== null) {
    const record = result as { readonly ok?: unknown }
    if (record.ok === false) return true
  }
  return false
}

/**
 * Attempt sequence: dispatch `session.new` through the keymap; any throw,
 * promise rejection, undefined result, or failed result falls back to a
 * user-facing reminder to open a new session.
 */
export async function attemptSessionRestart(
  keymap: RestartKeymap | undefined,
  command: string = SESSION_NEW_COMMAND,
  dispatch: RestartDispatcher = defaultRestartDispatcher,
): Promise<RestartAction> {
  if (keymap === undefined || keymap.dispatchCommand === undefined) return FALLBACK
  try {
    let result: unknown = dispatch(keymap, command)
    if (isThenable(result)) result = await result
    if (isFailedResult(result)) return FALLBACK
    return DISPATCHED
  } catch {
    return FALLBACK
  }
}
