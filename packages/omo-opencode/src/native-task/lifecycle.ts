import type { NativeTaskState } from "./types"

export function isTerminal(state: NativeTaskState): boolean {
  return state === "succeeded" || state === "failed" || state === "cancelled"
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
