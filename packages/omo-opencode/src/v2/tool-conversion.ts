import { tool, type ToolContext as V1ToolContext, type ToolDefinition, type ToolResult as V1ToolResult } from "@opencode-ai/plugin/tool"
import type { Info, Result as V2ToolResult, ToolContext as V2ToolContext } from "@opencode/plugin/promise/tool"
import type { ValueSchema } from "@opencode/schema/tool"
import "./tool-schema-runtime"
import { z } from "zod"

/**
 * V1 tools carry a zod v4 raw shape (`args`). With the runtime zod upgraded by
 * `ensureV1ToolSchemaRuntime` (see src/index.ts), the shape fields and this
 * wrapper share one zod copy, so the graph opencode receives is a single
 * runtime that implements the `~standard.jsonSchema` bridge. When a tool has
 * no shape we fall back to a permissive empty-object schema (equivalent to the
 * JSON Schema `{type:"object",properties:{}}` the V2 contract suggests) via
 * `z.object({}).passthrough()`, which accepts and preserves any input object.
 */
export function resolveV1InputSchema(def: ToolDefinition): ValueSchema {
  const shape = def.args
  if (shape && Object.keys(shape).length > 0) {
    return z.object(shape)
  }
  return z.object({}).passthrough()
}

/**
 * Adapt the V2 execution context into the V1 `ToolContext` shape that momo's
 * native tools consume. V2 provides `sessionID/agent/messageID/id/signal/progress`;
 * V1 additionally expects `directory/worktree/abort/metadata/ask`. We map
 * `signal -> abort`, bridge `metadata` onto `progress`, and supply defensive
 * defaults for the fields V2 does not surface (directory/worktree fall back to
 * the process cwd; `ask` is a no-op permission prompt).
 */
export function buildV1Context(context: V2ToolContext): V1ToolContext {
  return {
    sessionID: context.sessionID,
    messageID: context.messageID,
    agent: context.agent,
    directory: process.cwd(),
    worktree: process.cwd(),
    abort: context.signal,
    metadata: (input) => {
      void context.progress({
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.metadata ?? {}),
      })
    },
    ask: async () => {},
  }
}

/**
 * Map a V1 `ToolResult` onto the V2 `Tool.Result` shape.
 * - `string` -> `{ content: string }`
 * - object   -> `{ content: output|text, metadata }` (V1 uses `output`; some
 *   tools historically returned `text`, so both are honored defensively).
 */
export function mapV1Result(result: V1ToolResult): V2ToolResult {
  if (typeof result === "string") {
    return { content: result }
  }
  const text = result.output ?? (result as { text?: unknown }).text
  const content = typeof text === "string" ? text : undefined
  return {
    ...(content !== undefined ? { content } : {}),
    ...(result.metadata !== undefined ? { metadata: result.metadata } : {}),
  }
}

/**
 * Convert a single V1 `ToolDefinition` into the V2 `Info` add-shape consumed by
 * `ToolEditor.add`. Pure and synchronous so it is cheap to run inside a replayable
 * `transform` callback.
 */
export function convertV1ToolDefinition(name: string, def: ToolDefinition): Info {
  return {
    name,
    description: def.description,
    input: resolveV1InputSchema(def),
    execute: async (input, context) => {
      const v1Context = buildV1Context(context)
      const result = await def.execute(input, v1Context)
      return mapV1Result(result)
    },
  }
}
