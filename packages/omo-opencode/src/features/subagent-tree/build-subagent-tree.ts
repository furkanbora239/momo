import type { SubagentRow } from "./types"

export type SubagentNode = {
  readonly row: SubagentRow
  readonly depth: number
  readonly children: readonly SubagentNode[]
}

export type FlatSubagentNode = {
  readonly row: SubagentRow
  readonly depth: number
}

type MutableNode = {
  readonly row: SubagentRow
  readonly children: MutableNode[]
  depth: number
}

const STATUS_PRIORITY: Readonly<Record<string, number>> = {
  running: 0,
  pending: 1,
  queued: 1,
  interrupt: 2,
  error: 3,
  cancelled: 4,
  completed: 5,
}

function statusPriority(status: string): number {
  return STATUS_PRIORITY[status] ?? 6
}

function compareRows(left: SubagentRow, right: SubagentRow): number {
  const byStatus = statusPriority(left.status) - statusPriority(right.status)
  if (byStatus !== 0) {
    return byStatus
  }
  return (left.startedAt ?? Number.POSITIVE_INFINITY) - (right.startedAt ?? Number.POSITIVE_INFINITY)
}

function orderParentsBeforeChildren(rows: readonly SubagentRow[]): readonly SubagentRow[] {
  const sorted = [...rows].sort(compareRows)
  const ids = new Set(sorted.map((row) => row.id))
  const waiting = new Map<string, SubagentRow[]>()
  const placed = new Set<string>()
  const ordered: SubagentRow[] = []

  const place = (row: SubagentRow): void => {
    ordered.push(row)
    placed.add(row.id)
    for (const child of waiting.get(row.id) ?? []) {
      place(child)
    }
  }

  for (const row of sorted) {
    if (placed.has(row.id)) {
      continue
    }
    const parentID = row.parentId
    const parentKnown = parentID !== null && parentID !== row.id && ids.has(parentID)
    if (parentKnown && !placed.has(parentID)) {
      waiting.set(parentID, [...(waiting.get(parentID) ?? []), row])
      continue
    }
    place(row)
  }
  for (const row of sorted) {
    if (!placed.has(row.id)) {
      place(row)
    }
  }
  return ordered
}

export function buildSubagentTree(rows: readonly SubagentRow[]): SubagentNode[] {
  const ordered = orderParentsBeforeChildren(rows)
  const byId = new Map<string, MutableNode>()
  const roots: MutableNode[] = []
  for (const row of ordered) {
    const node: MutableNode = { row, children: [], depth: 0 }
    byId.set(row.id, node)
    const parent =
      row.parentId !== null && row.parentId !== row.id ? byId.get(row.parentId) : undefined
    if (parent !== undefined) {
      node.depth = parent.depth + 1
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }
  return roots
}

export function flattenSubagentTree(roots: readonly SubagentNode[]): readonly FlatSubagentNode[] {
  const flat: FlatSubagentNode[] = []
  const visit = (node: SubagentNode): void => {
    flat.push({ row: node.row, depth: node.depth })
    for (const child of node.children) {
      visit(child)
    }
  }
  for (const root of roots) {
    visit(root)
  }
  return flat
}
