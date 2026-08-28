import { mkdirSync } from "node:fs"
import { join } from "node:path"

import { Database } from "bun:sqlite"

export function createFixtureProject(projectRoot: string): void {
  const codegraphDir = join(projectRoot, ".codegraph")
  mkdirSync(codegraphDir)
  const db = new Database(join(codegraphDir, "codegraph.db"))
  db.exec(`
    CREATE TABLE nodes (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL,
      qualified_name TEXT NOT NULL, file_path TEXT NOT NULL, language TEXT NOT NULL,
      start_line INTEGER NOT NULL, end_line INTEGER NOT NULL,
      signature TEXT
    );
    CREATE TABLE edges (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, target TEXT NOT NULL,
      kind TEXT NOT NULL
    );
    CREATE TABLE files (
      path TEXT PRIMARY KEY, language TEXT NOT NULL, node_count INTEGER DEFAULT 0
    );
  `)
  const insertNode = db.prepare(
    `INSERT INTO nodes (id, kind, name, qualified_name, file_path, language, start_line, end_line, signature)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const nodes: Array<[string, string, string, string, string, string, number, number, string | null]> = [
    ["function:hub", "function", "hubFn", "hubFn", "src/engine.ts", "typescript", 10, 40, "(cfg) -> Result"],
    ["function:mid", "function", "midFn", "midFn", "src/engine.ts", "typescript", 50, 70, null],
    ["function:leaf", "function", "leafFn", "leafFn", "src/engine.ts", "typescript", 80, 90, null],
    ["function:helper", "function", "helperFn", "helperFn", "src/engine.ts", "typescript", 92, 95, null],
    ["function:caller1", "function", "caller1Fn", "caller1Fn", "src/api.ts", "typescript", 5, 20, "() -> void"],
    ["function:caller2", "function", "caller2Fn", "caller2Fn", "src/api.ts", "typescript", 25, 40, null],
    ["class:Widget", "class", "Widget", "Widget", "src/ui.tsx", "typescript", 3, 60, null],
    ["method:render", "method", "render", "Widget.render", "src/ui.tsx", "typescript", 12, 30, "() -> JSX.Element"],
    ["import:dep", "import", "lodash", "lodash", "src/api.ts", "typescript", 1, 1, null],
  ]
  for (const node of nodes) {
    insertNode.run(...node)
  }
  const insertEdge = db.prepare("INSERT INTO edges (source, target, kind) VALUES (?, ?, 'calls')")
  // hub: called by 3, calls 1 -> centrality 4. mid: called by hub, calls helper -> 2.
  // leaf and render: no call edges -> zero centrality, excluded from the map.
  for (const [source, target] of [
    ["function:caller1", "function:hub"],
    ["function:caller2", "function:hub"],
    ["class:Widget", "function:hub"],
    ["function:hub", "function:mid"],
    ["function:mid", "function:helper"],
  ] as Array<[string, string]>) {
    insertEdge.run(source, target)
  }
  const insertFile = db.prepare("INSERT INTO files (path, language, node_count) VALUES (?, ?, ?)")
  for (const [path, count] of [
    ["src/engine.ts", 4],
    ["src/api.ts", 3],
    ["src/ui.tsx", 2],
  ] as Array<[string, number]>) {
    insertFile.run(path, "typescript", count)
  }
  db.close()
}