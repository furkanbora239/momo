import { tool } from "@opencode-ai/plugin/tool"
import { z as zod } from "zod"

/**
 * opencode v2 converts a tool's `input` ValueSchema to JSON Schema through the
 * `~standard.jsonSchema` bridge, which zod added after 4.1.x. The `tool.schema`
 * namespace shipped by `@opencode-ai/plugin` pins zod 4.1.8, so every V1 field
 * schema momo composes lacks that bridge and opencode rejects the tool with
 * `seen.ref` crashes. Upgrade the shared namespace to momo's own zod runtime
 * before any tool field is composed — tool factories build fields lazily when
 * their factory function runs, after this module has executed.
 */
export function ensureV1ToolSchemaRuntime(): void {
  if (
    typeof tool.schema?.string === "function" &&
    (tool.schema.string() as { "~standard"?: { jsonSchema?: unknown } })["~standard"]?.jsonSchema !== undefined
  ) {
    return
  }
  tool.schema = zod as unknown as typeof tool.schema
}

ensureV1ToolSchemaRuntime()
