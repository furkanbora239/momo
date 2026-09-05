import type { RepoMapFile, RepoMapGraph, RepoMapSymbol } from "./sqlite-reader"

export interface RepoMapBuildOptions {
  tokenBudget: number
  rank: "centrality"
}

export interface RankedSymbol {
  symbol: RepoMapSymbol
  score: number
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Centrality score per symbol: in-degree + out-degree over `calls` edges.
 * A symbol that calls many others and is called by many others is the most
 * useful map entry because touching it touches the whole neighborhood.
 */
export function rankSymbolsByCentrality(
  graph: RepoMapGraph,
  symbols: RepoMapSymbol[],
): RankedSymbol[] {
  const degree = new Map<string, number>()
  for (const edge of graph.callEdges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }

  const ranked: RankedSymbol[] = []
  for (const symbol of symbols) {
    const score = degree.get(symbol.id) ?? 0
    if (score > 0) {
      ranked.push({ symbol, score })
    }
  }

  // Same (file, name) pairs collide on readable names in the map; keep the
  // higher-centrality row and drop the duplicate.
  const byName = new Map<string, RankedSymbol>()
  for (const entry of ranked) {
    const key = `${entry.symbol.filePath}:${entry.symbol.name}`
    const existing = byName.get(key)
    if (existing === undefined || entry.score > existing.score) {
      byName.set(key, entry)
    }
  }

  return [...byName.values()].sort(
    (left, right) =>
      right.score - left.score || left.symbol.name.localeCompare(right.symbol.name),
  )
}

interface TreeLine {
  text: string
}

function buildFileTreeLines(files: RepoMapFile[]): TreeLine[] {
  const roots = new Map<string, string[]>()
  for (const file of files) {
    const segments = file.path.split("/")
    const fileName = segments.pop() ?? file.path
    const directory = segments.join("/")
    const bucket = roots.get(directory)
    if (bucket === undefined) {
      roots.set(directory, [fileName])
    } else {
      bucket.push(fileName)
    }
  }

  const lines: TreeLine[] = []
  const indent = "  "

  const directories = [...roots.keys()].sort((a, b) => a.localeCompare(b))
  for (const directory of directories) {
    if (directory.length > 0) {
      lines.push({ text: `${indent}${directory}/` })
    }
    const fileNames = roots.get(directory) ?? []
    fileNames.sort((a, b) => a.localeCompare(b))
    for (const fileName of fileNames) {
      const file = files.find((candidate) => candidate.path === (directory.length === 0 ? fileName : `${directory}/${fileName}`))
      lines.push({
        text: `${indent}${indent}${fileName}${file !== undefined && file.symbolCount > 0 ? ` (${file.symbolCount})` : ""}`,
      })
    }
  }

  return lines
}

function formatSymbolLine(entry: RankedSymbol, maxNameLength: number): string {
  const name = entry.symbol.name
  const kind = entry.symbol.kind.replaceAll("_", " ")
  const signature = entry.symbol.signature === null ? "" : ` ${entry.symbol.signature}`
  return `    ${name.padEnd(maxNameLength)} ${kind}${signature}`
}

interface SymbolBlockLine {
  filePath: string
  text: string
}

function buildSymbolLines(ranked: RankedSymbol[]): SymbolBlockLine[] {
  const byFile = new Map<string, RankedSymbol[]>()
  for (const entry of ranked) {
    const bucket = byFile.get(entry.symbol.filePath)
    if (bucket === undefined) {
      byFile.set(entry.symbol.filePath, [entry])
    } else {
      bucket.push(entry)
    }
  }

  const fileScores = new Map<string, number>()
  for (const [filePath, entries] of byFile) {
    const first = entries[0]
    if (first !== undefined) fileScores.set(filePath, first.score)
  }

  const maxNameLength = Math.min(
    40,
    ranked.reduce((max, entry) => Math.max(max, entry.symbol.name.length), 0),
  )

  const lines: SymbolBlockLine[] = []
  const files = [...byFile.keys()].sort(
    (left, right) => (fileScores.get(right) ?? 0) - (fileScores.get(left) ?? 0) ||
      left.localeCompare(right),
  )
  for (const filePath of files) {
    lines.push({ filePath, text: `  ${filePath}` })
    for (const entry of byFile.get(filePath) ?? []) {
      lines.push({ filePath, text: formatSymbolLine(entry, maxNameLength) })
    }
  }
  return lines
}

export function formatRepoMap(ranked: RankedSymbol[], graph: RepoMapGraph): string {
  const treeLines = buildFileTreeLines(graph.files)
  const symbolLines = buildSymbolLines(ranked)

  const sections: string[] = [treeLines.map((line) => line.text).join("\n")]
  if (symbolLines.length > 0) {
    sections.push(symbolLines.map((line) => line.text).join("\n"))
  }

  return `<repo_map>\n${sections.join("\n<symbols>\n")}\n</repo_map>`
}

export function buildRepoMapBody(
  graph: RepoMapGraph,
  _options: RepoMapBuildOptions,
): string {
  const ranked = rankSymbolsByCentrality(graph, graph.symbols)
  return formatRepoMap(ranked, graph)
}

function headByTokenBudget(lines: string[], budget: number): string[] {
  const kept: string[] = []
  let tokens = 0
  for (const line of lines) {
    const lineTokens = estimateTokens(line)
    if (tokens + lineTokens > budget) break
    kept.push(line)
    tokens += lineTokens
  }
  return kept
}

export function truncateRepoMapToBudget(map: string, tokenBudget: number): string {
  if (estimateTokens(map) <= tokenBudget) return map

  const closingTag = "</repo_map>"
  const budgetForLines = tokenBudget - estimateTokens(closingTag)
  const headLines = map.slice(0, map.indexOf(closingTag)).split("\n")
  const kept = headByTokenBudget(headLines, budgetForLines)
  if (kept.length === 0) {
    return closingTag
  }
  return `${kept.join("\n").replace(/\n+$/, "")}\n${closingTag}`
}

export function buildRepoMap(graph: RepoMapGraph, options: RepoMapBuildOptions): string {
  const body = buildRepoMapBody(graph, options)
  return truncateRepoMapToBudget(body, options.tokenBudget)
}