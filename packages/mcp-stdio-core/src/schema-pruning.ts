// schema-pruning.ts — token-economy pruning for MCP tool descriptors.
//
// Trims token burn from tool schemas before they reach the model context:
// drops JSON-Schema noise keys (title, $schema, examples, default) recursively
// and caps description strings at a maximum length.

import { isPlainRecord } from "./record.js"
import type { McpToolDescriptor } from "./types.js"

const PRUNED_SCHEMA_KEYS = new Set(["title", "$schema", "examples", "default"])

export const DEFAULT_MAX_DESCRIPTION_LENGTH = 120

function truncateDescription(description: string, maxLength: number): string {
  return description.length <= maxLength ? description : description.slice(0, maxLength)
}

export function pruneToolSchema(
  schema: unknown,
  maxLength: number = DEFAULT_MAX_DESCRIPTION_LENGTH,
): unknown {
  if (Array.isArray(schema)) {
    return schema.map((entry) => pruneToolSchema(entry, maxLength))
  }
  if (!isPlainRecord(schema)) {
    return schema
  }
  const pruned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema)) {
    if (PRUNED_SCHEMA_KEYS.has(key)) continue
    if (key === "description" && typeof value === "string") {
      pruned[key] = truncateDescription(value, maxLength)
      continue
    }
    pruned[key] = pruneToolSchema(value, maxLength)
  }
  return pruned
}

export function pruneToolDescriptors(
  tools: readonly McpToolDescriptor[],
  maxLength: number = DEFAULT_MAX_DESCRIPTION_LENGTH,
): McpToolDescriptor[] {
  return tools.map((tool) => ({
    ...tool,
    description: truncateDescription(tool.description, maxLength),
    inputSchema: pruneToolSchema(tool.inputSchema, maxLength),
  }))
}
