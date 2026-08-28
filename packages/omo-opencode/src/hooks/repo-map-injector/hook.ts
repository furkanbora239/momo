import { log } from "../../shared"
import type { RepoMapConfig } from "../../config"
import { isRealUserMessage, isRealUserTextPart } from "../../shared"
import { buildRepoMap, type RepoMapBuildOptions } from "./map-builder"
import { readRepoMapGraph, resolveCodegraphDir, type RepoMapGraph } from "./sqlite-reader"

type TransformPart = {
  type: string
  text?: string
  synthetic?: boolean
  [key: string]: unknown
}

type TransformMessageInfo = {
  id: string
  role: string
  sessionID?: string
  [key: string]: unknown
}

type MessageWithParts = {
  info: TransformMessageInfo
  parts: TransformPart[]
}

type RepoMapInjectorInput = {
  sessionID?: string
  [key: string]: unknown
}

type RepoMapInjectorOutput = {
  messages: MessageWithParts[]
}

export type RepoMapInjectorHook = {
  "experimental.chat.messages.transform"?: (
    input: RepoMapInjectorInput,
    output: RepoMapInjectorOutput,
  ) => Promise<void>
}

export interface RepoMapInjectorDeps {
  resolveCodegraphDir: (startPath: string) => string | null
  readRepoMapGraph: (codegraphDir: string) => Promise<RepoMapGraph | null>
  buildRepoMap: (graph: RepoMapGraph, options: RepoMapBuildOptions) => string
  log: (message: string, data?: Record<string, unknown>) => void
}

export interface RepoMapInjectorContext {
  readonly directory: string | null
}

const defaultDeps: RepoMapInjectorDeps = {
  resolveCodegraphDir,
  readRepoMapGraph,
  buildRepoMap,
  log,
}

function resolveSessionID(
  input: RepoMapInjectorInput,
  messages: MessageWithParts[],
): string | undefined {
  if (typeof input.sessionID === "string" && input.sessionID.length > 0) {
    return input.sessionID
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const sessionID = messages[index]?.info.sessionID
    if (typeof sessionID === "string" && sessionID.length > 0) {
      return sessionID
    }
  }

  return undefined
}

function findLastUserMessage(messages: MessageWithParts[]): MessageWithParts | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.info.role === "user") {
      return message
    }
  }

  return undefined
}

function hasText(part: TransformPart): boolean {
  return typeof part.text === "string" && part.text.length > 0
}

export function createRepoMapInjectorHook(
  ctx: RepoMapInjectorContext,
  config: RepoMapConfig,
  depsOverride: Partial<RepoMapInjectorDeps> = {},
): RepoMapInjectorHook {
  const deps: RepoMapInjectorDeps = { ...defaultDeps, ...depsOverride }
  const renderedMaps = new Map<string, string | null>()
  const injectedSessions = new Set<string>()
  const buildOptions: RepoMapBuildOptions = {
    tokenBudget: config.token_budget,
    rank: config.rank,
  }

  function renderMap(startPath: string): Promise<string | null> {
    return (async () => {
      try {
        const codegraphDir = deps.resolveCodegraphDir(startPath)
        if (codegraphDir === null) {
          return null
        }
        const graph = await deps.readRepoMapGraph(codegraphDir)
        if (graph === null) {
          return null
        }
        return deps.buildRepoMap(graph, buildOptions)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        deps.log("[repo-map-injector] Render failed", { error: message })
        return null
      }
    })()
  }

  return {
    "experimental.chat.messages.transform": async (input, output): Promise<void> => {
      if (!config.enabled || output.messages.length === 0) {
        return
      }

      const sessionID = resolveSessionID(input, output.messages)
      if (sessionID === undefined || injectedSessions.has(sessionID)) {
        return
      }

      const lastUserMessage = findLastUserMessage(output.messages)
      if (lastUserMessage === undefined || !isRealUserMessage(lastUserMessage)) {
        return
      }

      const textPartIndex = lastUserMessage.parts.findIndex(
        (part) => isRealUserTextPart(part) && hasText(part),
      )
      if (textPartIndex === -1) {
        return
      }

      const cached = renderedMaps.get(sessionID)
      const repoMap = cached === undefined ? await renderMap(ctx.directory ?? process.cwd()) : cached
      renderedMaps.set(sessionID, repoMap)
      if (repoMap === null) {
        return
      }

      const syntheticPart = {
        id: `prt_synthetic_repo_map_${sessionID}`,
        messageID: lastUserMessage.info.id,
        sessionID: lastUserMessage.info.sessionID ?? "",
        type: "text" as const,
        text: repoMap,
        synthetic: true,
      }

      lastUserMessage.parts.splice(textPartIndex, 0, syntheticPart)
      injectedSessions.add(sessionID)
      deps.log("[repo-map-injector] Injected repo map", {
        sessionID,
        mapLength: repoMap.length,
        tokenBudget: config.token_budget,
      })
    },
  }
}