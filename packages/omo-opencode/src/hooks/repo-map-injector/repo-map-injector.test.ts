import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { Database } from "bun:sqlite"
import { afterEach, describe, expect, it } from "bun:test"

import { createRepoMapInjectorHook } from "."
import { estimateTokens, rankSymbolsByCentrality, truncateRepoMapToBudget } from "./map-builder"
import { readRepoMapGraph } from "./sqlite-reader"
import { resolveCodegraphDir } from "./sqlite-reader"

type TransformPart = {
  type: string
  text?: string
  synthetic?: boolean
}

type TransformMessage = {
  info: { id: string; role: string; sessionID?: string }
  parts: TransformPart[]
}

type TransformOutput = {
  messages: TransformMessage[]
}

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "repo-map-injector-"))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function createFixtureProject(): string {
  const projectRoot = makeTempDir()
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
  const edges: Array<[string, string]> = [
    // hub: called by 3, calls 2 -> centrality 5
    ["function:caller1", "function:hub"],
    ["function:caller2", "function:hub"],
    ["class:Widget", "function:hub"],
    ["function:hub", "function:mid"],
    // mid: called by hub, calls helper -> centrality 2
    ["function:mid", "function:helper"],
    // leaf: no edges at all -> zero centrality, excluded from the map
  ]
  for (const [source, target] of edges) {
    insertEdge.run(source, target)
  }
  const insertFile = db.prepare(
    "INSERT INTO files (path, language, node_count) VALUES (?, ?, ?)",
  )
  for (const [path, count] of [
    ["src/engine.ts", 3],
    ["src/api.ts", 3],
    ["src/ui.tsx", 2],
  ] as Array<[string, number]>) {
    insertFile.run(path, "typescript", count)
  }
  db.close()
  return projectRoot
}

describe("resolveCodegraphDir", () => {
  it("#given a project with a codegraph.db #when resolving from a nested path #then the project .codegraph dir is found", () => {
    // given
    const projectRoot = createFixtureProject()
    const nested = join(projectRoot, "packages", "core", "src")

    // when
    const codegraphDir = resolveCodegraphDir(nested)

    // then
    expect(codegraphDir).toBe(join(projectRoot, ".codegraph"))
  })

  it("#given no codegraph.db anywhere up the tree #when resolving #then null is returned", () => {
    // given
    const projectRoot = makeTempDir()

    // when
    const codegraphDir = resolveCodegraphDir(projectRoot)

    // then
    expect(codegraphDir).toBeNull()
  })
})

describe("readRepoMapGraph", () => {
  it("#given a fixture codegraph db #when reading #then symbols, files and call edges are returned", async () => {
    // given
    const projectRoot = createFixtureProject()

    // when
    const graph = await readRepoMapGraph(join(projectRoot, ".codegraph"))

    // then
    expect(graph).not.toBeNull()
    expect(graph?.files).toHaveLength(3)
    const symbolNames = graph?.symbols.map((symbol) => symbol.name).sort() ?? []
    expect(symbolNames).toEqual(["Widget", "caller1Fn", "caller2Fn", "helperFn", "hubFn", "midFn"].sort())
    expect(graph?.callEdges).toHaveLength(5)
  })

  it("#given no db file #when reading #then null is returned", async () => {
    // given
    const projectRoot = makeTempDir()
    mkdirSync(join(projectRoot, ".codegraph"))

    // when
    const graph = await readRepoMapGraph(join(projectRoot, ".codegraph"))

    // then
    expect(graph).toBeNull()
  })
})

describe("rankSymbolsByCentrality", () => {
  it("#given symbols with unequal call degrees #when ranking #then highest centrality comes first and zero-degree symbols are excluded", async () => {
    // given
    const projectRoot = createFixtureProject()
    const graph = await readRepoMapGraph(join(projectRoot, ".codegraph"))
    expect(graph).not.toBeNull()
    const graphValue = graph!

    // when
    const ranked = rankSymbolsByCentrality(graphValue, graphValue.symbols)

    // then
    expect(ranked[0]?.symbol.name).toBe("hubFn")
    expect(ranked[0]?.score).toBe(4)
    expect(ranked.map((entry) => entry.symbol.name)).not.toContain("leafFn")
    const scores = ranked.map((entry) => entry.score)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
  })

  it("#given duplicate symbol names in one file #when ranking #then only the higher-centrality row survives", () => {
    // given
    const graph = {
      codegraphDir: "/fixture",
      files: [],
      symbols: [
        { id: "function:dupA", name: "dupFn", kind: "function", qualifiedName: "dupFn", signature: null, startLine: 1, filePath: "src/a.ts" },
        { id: "function:dupB", name: "dupFn", kind: "function", qualifiedName: "dupFn", signature: null, startLine: 2, filePath: "src/a.ts" },
      ],
      callEdges: [
        { source: "function:dupB", target: "function:target" },
        { source: "caller", target: "function:dupA" },
      ],
    }

    // when
    const ranked = rankSymbolsByCentrality(graph, graph.symbols)

    // then
    expect(ranked).toHaveLength(1)
    expect(ranked[0]?.symbol.id).toBe("function:dupA")
  })
})

describe("truncateRepoMapToBudget", () => {
  it("#given a map larger than the budget #when truncating #then the result stays within the token budget", () => {
    // given
    const longSymbolLine = "    extremelyLongFunctionNameWithManyCharactersAndASignatureThatKeepsGoing"
    const map = `<repo_map>\nsrc/\n  engine.ts (3)\n<symbols>\n${longSymbolLine}\n${longSymbolLine}\n${longSymbolLine}\n${longSymbolLine}\n</repo_map>`

    // when
    const truncated = truncateRepoMapToBudget(map, 12)

    // then
    expect(estimateTokens(truncated)).toBeLessThanOrEqual(12 + 3)
    expect(truncated).toContain("<repo_map>")
    expect(truncated).toContain("</repo_map>")
  })

  it("#given a map within the budget #when truncating #then the map is returned unchanged", () => {
    // given
    const map = "<repo_map>\nsrc/\n  engine.ts (3)\n</repo_map>"

    // when
    const truncated = truncateRepoMapToBudget(map, 100)

    // then
    expect(truncated).toBe(map)
  })
})

function createOutput(messageText = "what does this code do"): TransformOutput {
  return {
    messages: [
      {
        info: { id: "msg_1", role: "user", sessionID: "ses_1" },
        parts: [{ type: "text", text: messageText }],
      },
    ],
  }
}

function injectedRepoMapParts(output: TransformOutput): string[] {
  return output.messages
    .flatMap((message) => message.parts)
    .filter((part) => part.synthetic === true && part.text?.startsWith("<repo_map>") === true)
    .map((part) => part.text ?? "")
}

describe("createRepoMapInjectorHook", () => {
  it("#given repo_map enabled and a fixture index #when the first user message transforms #then the map is injected once", async () => {
    // given
    const projectRoot = createFixtureProject()
    const hook = createRepoMapInjectorHook(
      { directory: projectRoot },
      { enabled: true, token_budget: 1536, rank: "centrality" },
    )
    const output = createOutput()

    // when
    await hook["experimental.chat.messages.transform"]?.({ sessionID: "ses_1" }, output)
    await hook["experimental.chat.messages.transform"]?.({ sessionID: "ses_1" }, output)

    // then
    const maps = injectedRepoMapParts(output)
    expect(maps).toHaveLength(1)
    expect(maps[0]).toContain("hubFn")
    expect(maps[0]).toContain("engine.ts")
    expect(maps[0]).not.toContain("leafFn")
  })

  it("#given repo_map disabled #when a user message transforms #then the output is unchanged", async () => {
    // given
    const projectRoot = createFixtureProject()
    const hook = createRepoMapInjectorHook(
      { directory: projectRoot },
      { enabled: false, token_budget: 1536, rank: "centrality" },
    )
    const output = createOutput()
    const original = structuredClone(output)

    // when
    await hook["experimental.chat.messages.transform"]?.({ sessionID: "ses_1" }, output)

    // then
    expect(output).toEqual(original)
  })

  it("#given no codegraph db is reachable #when a user message transforms #then the output is unchanged", async () => {
    // given
    const emptyProject = makeTempDir()
    const hook = createRepoMapInjectorHook(
      { directory: emptyProject },
      { enabled: true, token_budget: 1536, rank: "centrality" },
    )
    const output = createOutput()
    const original = structuredClone(output)

    // when
    await hook["experimental.chat.messages.transform"]?.({ sessionID: "ses_1" }, output)

    // then
    expect(output).toEqual(original)
  })

  it("#given a synthetic user message #when it transforms #then no map is injected", async () => {
    // given
    const projectRoot = createFixtureProject()
    const hook = createRepoMapInjectorHook(
      { directory: projectRoot },
      { enabled: true, token_budget: 1536, rank: "centrality" },
    )
    const output = createOutput()
    output.messages[0]!.parts = [{ type: "text", text: "continue", synthetic: true }]

    // when
    await hook["experimental.chat.messages.transform"]?.({ sessionID: "ses_1" }, output)

    // then
    expect(injectedRepoMapParts(output)).toHaveLength(0)
  })

  it("#given two distinct sessions #when each sends its first message #then each session receives its own map", async () => {
    // given
    const projectRoot = createFixtureProject()
    const hook = createRepoMapInjectorHook(
      { directory: projectRoot },
      { enabled: true, token_budget: 1536, rank: "centrality" },
    )
    const firstSessionOutput: TransformOutput = {
      messages: [
        { info: { id: "msg_1", role: "user", sessionID: "ses_1" }, parts: [{ type: "text", text: "a" }] },
      ],
    }
    const secondSessionOutput: TransformOutput = {
      messages: [
        { info: { id: "msg_2", role: "user", sessionID: "ses_2" }, parts: [{ type: "text", text: "b" }] },
      ],
    }

    // when
    await hook["experimental.chat.messages.transform"]?.({}, firstSessionOutput)
    await hook["experimental.chat.messages.transform"]?.({}, secondSessionOutput)

    // then
    expect(injectedRepoMapParts(firstSessionOutput)).toHaveLength(1)
    expect(injectedRepoMapParts(secondSessionOutput)).toHaveLength(1)
  })

  it("#given a codegraph db that throws mid-read #when a user message transforms #then the hook falls back to a no-op", async () => {
    // given
    const projectRoot = createFixtureProject()
    writeFileSync(join(projectRoot, ".codegraph", "codegraph.db"), "not a database")
    const hook = createRepoMapInjectorHook(
      { directory: projectRoot },
      { enabled: true, token_budget: 1536, rank: "centrality" },
    )
    const output = createOutput()
    const original = structuredClone(output)

    // when
    await hook["experimental.chat.messages.transform"]?.({ sessionID: "ses_1" }, output)

    // then
    expect(output).toEqual(original)
  })
})