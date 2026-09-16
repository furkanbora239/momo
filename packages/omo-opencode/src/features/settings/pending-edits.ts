export type SettingCurrentValue = {
  readonly present: boolean
  readonly value: unknown
}

export type PendingEdit = {
  readonly id: string
  readonly path: readonly (string | number)[]
  readonly value: unknown
  readonly currentLabel: string
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left === "number" && typeof right === "number") {
    if (Number.isNaN(left) && Number.isNaN(right)) return true
    return left === right
  }
  return false
}

export function pendingEditIds(edits: readonly PendingEdit[]): readonly string[] {
  return edits.map((edit) => edit.id)
}

/**
 * Adds a pending edit for `next`. Replaces an existing edit on the same path.
 * When the new value matches the current on-disk value the pending edit is
 * dropped entirely (nothing to change).
 */
export function addPendingEdit(
  edits: readonly PendingEdit[],
  next: {
    readonly id: string
    readonly path: readonly (string | number)[]
    readonly value: unknown
    readonly current: SettingCurrentValue
    readonly defaultLabel: string
  },
): readonly PendingEdit[] {
  const remaining = edits.filter((edit) => edit.id !== next.id)
  if (next.current.present && valuesEqual(next.current.value, next.value)) {
    return remaining
  }
  const currentLabel = next.current.present
    ? formatPendingValue(next.current.value)
    : next.defaultLabel
  return [...remaining, {
    id: next.id,
    path: [...next.path],
    value: next.value,
    currentLabel,
  }]
}

export function removePendingEdit(
  edits: readonly PendingEdit[],
  id: string,
): readonly PendingEdit[] {
  return edits.filter((edit) => edit.id !== id)
}

export function formatPendingValue(value: unknown): string {
  if (value === undefined) return "(unset)"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") return String(value)
  if (typeof value === "string") return value
  return JSON.stringify(value)
}

export function serializePendingEditDiff(edit: PendingEdit): string {
  return `${edit.id}: ${edit.currentLabel} -> ${formatPendingValue(edit.value)}`
}

export function serializePendingEditDiffs(edits: readonly PendingEdit[]): readonly string[] {
  return edits.map(serializePendingEditDiff)
}
