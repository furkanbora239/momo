import { createHash } from "node:crypto"

type Atom = null | boolean | number | string | { ref: string }
type Node = { kind: "array"; items: Atom[] } | { kind: "object"; fields: Record<string, Atom> }
export type ContentLine = { version: 2; type: "content"; hash: string; node: Node }

const digest = (node: Node): string => createHash("sha256").update(JSON.stringify(node)).digest("hex")

/** Encode every container explicitly so authored data cannot impersonate a reference. */
export function encodeLedgerContent(value: unknown, known: Map<string, Node>): { ref: string; lines: ContentLine[] } {
  const lines: ContentLine[] = []
  function encode(item: unknown): Atom {
    if (item === null || typeof item === "string" || typeof item === "boolean" || typeof item === "number") return item
    if (!item || typeof item !== "object") throw new Error("invalid ledger content")
    const node: Node = Array.isArray(item)
      ? { kind: "array", items: item.map(encode) }
      : { kind: "object", fields: Object.fromEntries(Object.entries(item).map(([key, field]) => [key, encode(field)])) }
    const hash = digest(node)
    if (!known.has(hash)) { known.set(hash, node); lines.push({ version: 2, type: "content", hash, node }) }
    return { ref: hash }
  }
  const root = encode(value)
  if (!root || typeof root !== "object") throw new Error("ledger record must be a container")
  return { ref: root.ref, lines }
}

export function acceptLedgerContent(value: unknown, nodes: Map<string, Node>): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (row.version !== 2 || row.type !== "content" || typeof row.hash !== "string" || !row.node || typeof row.node !== "object") return false
  const node = row.node as Node
  if (node.kind === "array" ? !Array.isArray(node.items) : node.kind === "object" ? !node.fields || typeof node.fields !== "object" || Array.isArray(node.fields) : true) throw new Error("invalid content node")
  if (digest(node) !== row.hash) throw new Error("content hash mismatch")
  // Dependencies must precede their parent, preventing cycles and forward references.
  const values = node.kind === "array" ? node.items : Object.values(node.fields)
  for (const item of values) {
    if (item !== null && typeof item === "object" && (Array.isArray(item) || Object.keys(item).length !== 1 || typeof item.ref !== "string" || !nodes.has(item.ref))) throw new Error("missing or invalid content reference")
    if (item !== null && !["boolean", "number", "string", "object"].includes(typeof item)) throw new Error("invalid content atom")
  }
  nodes.set(row.hash, node)
  return true
}

export function decodeLedgerContent(ref: string, nodes: Map<string, Node>): unknown {
  const decoded = new Map<string, unknown>()
  function decode(hash: string): unknown {
    if (decoded.has(hash)) return decoded.get(hash)
    const node = nodes.get(hash)
    if (!node) throw new Error("missing ledger content reference")
    const atom = (value: Atom): unknown => value !== null && typeof value === "object" ? decode(value.ref) : value
    const value = node.kind === "array" ? node.items.map(atom) : Object.fromEntries(Object.entries(node.fields).map(([key, field]) => [key, atom(field)]))
    decoded.set(hash, value)
    return value
  }
  return decode(ref)
}

export type LedgerContentIndex = Map<string, Node>
