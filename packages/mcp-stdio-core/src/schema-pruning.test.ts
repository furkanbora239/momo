import { describe, expect, it } from "bun:test"
import {
  pruneToolDescriptors,
  pruneToolSchema,
} from "./schema-pruning"

function asRecord(value: unknown): Record<string, unknown> {
  expect(value).toBeDefined()
  return value as Record<string, unknown>
}

describe("pruneToolSchema", () => {
  it("drops title, $schema, examples and default keys recursively", () => {
    //#given
    const schema = {
      type: "object",
      $schema: "http://json-schema.org/draft-07/schema#",
      title: "Root title",
      properties: {
        name: { type: "string", title: "Name", default: "x" },
        nested: {
          type: "object",
          title: "Nested",
          properties: {
            tags: { type: "array", items: { type: "string", examples: ["a"] } },
          },
        },
      },
    }

    //#when
    const pruned = pruneToolSchema(schema)

    //#then
    expect(pruned).toMatchObject({ type: "object" })
    expect(pruned).not.toHaveProperty("$schema")
    expect(pruned).not.toHaveProperty("title")
    const properties = asRecord(asRecord(pruned)["properties"])
    const name = asRecord(properties["name"])
    expect(name["title"]).toBeUndefined()
    expect(name["default"]).toBeUndefined()
    expect(name["type"]).toBe("string")
    const nested = asRecord(properties["nested"])
    expect(nested["title"]).toBeUndefined()
    const tags = asRecord(asRecord(nested["properties"])["tags"])
    const items = asRecord(tags["items"])
    expect(items["examples"]).toBeUndefined()
    expect(items["type"]).toBe("string")
  })

  it("caps description strings at 120 characters but leaves short ones intact", () => {
    //#given
    const long = "x".repeat(200)
    const schema = {
      description: long,
      properties: {
        inner: { description: "short" },
      },
    }

    //#when
    const pruned = pruneToolSchema(schema)

    //#then
    expect(asRecord(pruned)["description"]).toBe("x".repeat(120))
    const inner = asRecord(asRecord(asRecord(pruned)["properties"])["inner"])
    expect(inner["description"]).toBe("short")
  })

  it("leaves non-record schemas and other keys untouched", () => {
    //#given
    const schema = { required: ["a", "b"], enum: ["one", "two"], minLength: 2 }

    //#when
    const pruned = pruneToolSchema(schema)

    //#then
    expect(pruned).toEqual(schema)
    expect(pruneToolSchema("scalar")).toBe("scalar")
    expect(pruneToolSchema(42)).toBe(42)
  })
})

describe("pruneToolDescriptors", () => {
  it("prunes the descriptor description and its inputSchema", () => {
    //#given
    const tools = [
      {
        name: "tool_a",
        description: "y".repeat(300),
        inputSchema: {
          type: "object",
          title: "Tool A",
          properties: { flag: { type: "boolean", default: true, description: "z".repeat(150) } },
        },
      },
    ]

    //#when
    const pruned = pruneToolDescriptors(tools)

    //#then
    expect(pruned[0]?.description).toBe("y".repeat(120))
    const schema = asRecord(pruned[0]?.inputSchema)
    expect(schema["title"]).toBeUndefined()
    const flag = asRecord(asRecord(schema["properties"])["flag"])
    expect(flag["default"]).toBeUndefined()
    expect(flag["description"]).toBe("z".repeat(120))
  })
})
