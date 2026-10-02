// config-diff.ts — pure comparison helpers for the V1 config handler bridge.
//
// The V1 config handler mutates a plain config object in place. To discover
// what it changed we snapshot the seeded config, run the handler, and diff the
// agent/command/mcp/provider/model maps. Every function here is pure and
// synchronous so diffing stays cheap and unit-testable.

export interface RecordDiff {
  readonly added: readonly string[]
  readonly changed: readonly string[]
  readonly removed: readonly string[]
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Object.is semantics, so NaN still compares equal to itself. */
function primitivesEqual(a: unknown, b: unknown): boolean {
  return Object.is(a, b)
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (primitivesEqual(a, b)) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    return a.every((item, index) => deepEqual(item, b[index]))
  }
  if (isPlainRecord(a) && isPlainRecord(b)) {
    const aKeys = definedKeys(a)
    const bKeys = definedKeys(b)
    if (aKeys.length !== bKeys.length) return false
    return aKeys.every((key) => key in b && deepEqual(a[key], b[key]))
  }
  return false
}

/**
 * Keys whose value is not `undefined`. Explicit `undefined` values are treated
 * as absent so `{ a: undefined }` compares equal to `{}`.
 */
export function definedKeys(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter((key) => record[key] !== undefined)
}

export function diffRecordKeys(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): RecordDiff {
  const added: string[] = []
  const changed: string[] = []
  const removed: string[] = []
  for (const key of definedKeys(after)) {
    if (!(key in before) || before[key] === undefined) {
      added.push(key)
    } else if (!deepEqual(before[key], after[key])) {
      changed.push(key)
    }
  }
  for (const key of definedKeys(before)) {
    if (!(key in after) || after[key] === undefined) {
      removed.push(key)
    }
  }
  return { added, changed, removed }
}
