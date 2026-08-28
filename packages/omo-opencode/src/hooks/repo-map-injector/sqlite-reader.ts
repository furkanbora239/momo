import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

type BunDatabase = import("bun:sqlite").Database

export interface RepoMapSymbol {
  id: string
  name: string
  kind: string
  qualifiedName: string
  signature: string | null
  startLine: number
  filePath: string
}

export interface RepoMapFile {
  path: string
  symbolCount: number
  language: string | null
}

export interface RepoMapCallEdge {
  source: string
  target: string
}

export interface RepoMapGraph {
  codegraphDir: string
  files: RepoMapFile[]
  symbols: RepoMapSymbol[]
  callEdges: RepoMapCallEdge[]
}

// Symbols worth surfacing in a compressed map: callable/type declarations.
// import/variable/field/enum_member/type_alias rows are noise for the map.
const MAP_WORTHY_KINDS = new Set([
  "class",
  "component",
  "enum",
  "function",
  "interface",
  "method",
  "route",
  "struct",
])

function mapWorthyKind(kind: string): boolean {
  return MAP_WORTHY_KINDS.has(kind)
}

/**
 * Walk up from `startPath` to find the nearest `.codegraph` directory holding a
 * `codegraph.db`, mirroring how the codegraph CLI discovers its index. Returns
 * null when no indexed project is reachable.
 */
export function resolveCodegraphDir(startPath: string): string | null {
  let current = resolve(startPath)
  for (;;) {
    const codegraphDir = join(current, ".codegraph")
    if (existsSync(join(codegraphDir, "codegraph.db"))) {
      return codegraphDir
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/**
 * Safe bun:sqlite import. The plugin bundle also runs under Node (Electron-hosted
 * opencode, dist-bundle tests), so the `bun:` specifier must be hidden from the
 * static ESM loader; without a Bun runtime no DB can ever be opened, so a null
 * result means the reader is unavailable, not an error.
 */
async function importBunSqlite(): Promise<typeof import("bun:sqlite") | null> {
  if (typeof globalThis.Bun === "undefined") {
    return null
  }
  try {
    const dynamicImport = new Function(
      "return import('bun:sqlite')",
    ) as () => Promise<typeof import("bun:sqlite")>
    return await dynamicImport()
  } catch (error) {
    if (error instanceof Error) {
      return null
    }
    return null
  }
}

interface FileRow {
  path: string
  node_count: number | null
  language: string | null
}

interface SymbolRow {
  id: string
  name: string
  kind: string
  qualified_name: string
  signature: string | null
  start_line: number
  file_path: string
}

interface EdgeRow {
  source: string
  target: string
}

interface CodegraphDbViews {
  files: FileRow[]
  symbols: SymbolRow[]
  edges: EdgeRow[]
}

function readCodegraphDb(db: BunDatabase): CodegraphDbViews {
  const files = db.query("SELECT path, node_count, language FROM files").all() as FileRow[]
  const symbols = db
    .query(
      `SELECT id, name, kind, qualified_name, signature, start_line, file_path
       FROM nodes
       WHERE EXISTS (
         SELECT 1 FROM edges e
         WHERE e.kind = 'calls' AND (e.source = nodes.id OR e.target = nodes.id)
       )`,
    )
    .all() as SymbolRow[]
  const edges = db.query("SELECT source, target FROM edges WHERE kind = 'calls'").all() as EdgeRow[]
  return { files, symbols, edges }
}

export async function readRepoMapGraph(codegraphDir: string): Promise<RepoMapGraph | null> {
  const dbPath = join(codegraphDir, "codegraph.db")
  if (!existsSync(dbPath)) return null

  const sqlite = await importBunSqlite()
  if (sqlite === null) return null

  const db = new sqlite.Database(dbPath, { readonly: true })
  try {
    const views = readCodegraphDb(db)
    const symbols: RepoMapSymbol[] = []
    for (const row of views.symbols) {
      if (!mapWorthyKind(row.kind)) continue
      symbols.push({
        id: row.id,
        name: row.name,
        kind: row.kind,
        qualifiedName: row.qualified_name,
        signature: row.signature,
        startLine: row.start_line,
        filePath: row.file_path,
      })
    }

    return {
      codegraphDir,
      files: views.files.map((row) => ({
        path: row.path,
        symbolCount: row.node_count ?? 0,
        language: row.language,
      })),
      symbols,
      callEdges: views.edges.map((row) => ({ source: row.source, target: row.target })),
    }
  } finally {
    db.close()
  }
}