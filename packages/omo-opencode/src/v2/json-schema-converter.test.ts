import { describe, expect, it } from "bun:test"
import { z } from "zod"
import { toPortableJsonSchema, toPortableJsonSchemaForShape } from "./json-schema-converter"

describe("#given scalar schemas", () => {
  it("#when converted then primitive type markers are emitted", () => {
    expect(toPortableJsonSchema(z.string())).toEqual({ type: "string" })
    expect(toPortableJsonSchema(z.number())).toEqual({ type: "number" })
    expect(toPortableJsonSchema(z.boolean())).toEqual({ type: "boolean" })
    expect(toPortableJsonSchema(z.null())).toEqual({ type: "null" })
  })

  it("#when given unknown then an open schema is emitted", () => {
    expect(toPortableJsonSchema(z.unknown())).toEqual({})
  })
})

describe("#given structured schemas", () => {
  it("#when given a literal then a const is emitted", () => {
    expect(toPortableJsonSchema(z.literal("replace"))).toEqual({ const: "replace" })
  })

  it("#when given an enum then the values are emitted", () => {
    expect(toPortableJsonSchema(z.enum(["content", "files_with_matches", "count"]))).toEqual({
      enum: ["content", "files_with_matches", "count"],
    })
  })

  it("#when given an array then items are emitted", () => {
    expect(toPortableJsonSchema(z.array(z.string()))).toEqual({
      type: "array",
      items: { type: "string" },
    })
  })

  it("#when given an object then properties and required are emitted", () => {
    expect(
      toPortableJsonSchema(
        z.object({ pattern: z.string(), output_mode: z.string().optional() }),
      ),
    ).toEqual({
      type: "object",
      properties: { pattern: { type: "string" }, output_mode: { type: "string" } },
      required: ["pattern"],
    })
  })

  it("#when given a record then additionalProperties are emitted", () => {
    expect(toPortableJsonSchema(z.record(z.string(), z.unknown()))).toEqual({
      type: "object",
    })
  })

  it("#when given a union then anyOf is emitted", () => {
    expect(toPortableJsonSchema(z.union([z.string(), z.null()]))).toEqual({
      anyOf: [{ type: "string" }, { type: "null" }],
    })
  })
})

describe("#given soft wrappers", () => {
  it("#when given optional, nullable or default then the inner type is emitted", () => {
    expect(toPortableJsonSchema(z.string().optional())).toEqual({ type: "string" })
    expect(toPortableJsonSchema(z.string().nullable())).toEqual({ type: "string" })
    expect(toPortableJsonSchema(z.string().default("x"))).toEqual({ type: "string" })
  })

  it("#when given describe chains then the type stays intact", () => {
    expect(toPortableJsonSchema(z.string().optional().describe("a tool field"))).toEqual({
      type: "string",
    })
  })
})

describe("#given a real momo tool shape", () => {
  it("#when converted then the hashline-edit shape is emitted faithfully", () => {
    const schema = toPortableJsonSchemaForShape({
      filePath: z.string(),
      edits: z.array(
        z.object({
          op: z.union([z.literal("replace"), z.literal("append"), z.literal("prepend")]),
          pos: z.string().optional(),
          end: z.string().optional(),
          lines: z.union([z.array(z.string()), z.string(), z.null()]),
        }),
      ),
    })

    expect(JSON.parse(JSON.stringify(schema))).toEqual({
      type: "object",
      properties: {
        filePath: { type: "string" },
        edits: {
          type: "array",
          items: {
            type: "object",
            properties: {
              op: { anyOf: [{ const: "replace" }, { const: "append" }, { const: "prepend" }] },
              pos: { type: "string" },
              end: { type: "string" },
              lines: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "string" }, { type: "null" }] },
            },
            required: ["op", "lines"],
          },
        },
      },
      required: ["filePath", "edits"],
    })
  })

  it("#when given the grep shape then optional fields stay out of required", () => {
    const schema = toPortableJsonSchemaForShape({
      pattern: z.string(),
      include: z.string().optional(),
      output_mode: z.enum(["content", "files_with_matches", "count"]).optional(),
      head_limit: z.number().optional(),
    })

    expect(schema.required).toEqual(["pattern"])
  })
})

describe("#given degenerate input", () => {
  it("#when cycles are present then conversion does not recurse forever", () => {
    let schema: unknown
    const lazy = z.lazy(() => schema ?? z.string())
    schema = z.object({ self: lazy })
    const out = toPortableJsonSchema(schema)
    expect(out).toEqual({
      type: "object",
      properties: { self: {} },
      required: ["self"],
    })
  })

  it("#when the input is not a zod schema then an open schema is emitted", () => {
    expect(toPortableJsonSchema(undefined)).toEqual({})
    expect(toPortableJsonSchema({ not: "a schema" })).toEqual({})
  })
})