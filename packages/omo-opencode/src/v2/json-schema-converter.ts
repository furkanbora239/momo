// json-schema-converter.ts — portable JSON Schema emission for V1 tool inputs.
//
// opencode v2 validates tool registrations by converting the input schema to
// JSON Schema through the schema's own zod `~standard.jsonSchema` bridge.
// Zod 4.4.x's generator resolves `parent`/`ref` chains during flattenRef and
// can hit nodes that were never registered in its seen map, throwing
// `undefined is not an object (evaluating 'seen.ref')` for every tool. This
// converter walks the zod instance graph directly and emits a plain JSON
// Schema object, so the opencode-side converter only ever sees data, never a
// zod instance.

export type JsonSchemaNode = Record<string, unknown>

const MAX_DEPTH = 24

interface ZodDef {
  type?: unknown
  innerType?: unknown
  element?: unknown
  valueType?: unknown
  values?: unknown
  entries?: unknown
  shape?: unknown
  options?: unknown
  catchall?: unknown
  value?: unknown
  getter?: () => unknown
}

function zodDef(schema: unknown): ZodDef | undefined {
  const inner = (schema as { _zod?: { def?: ZodDef } } | null | undefined)?._zod?.def
  return typeof inner === "object" && inner !== null ? inner : undefined
}

function isSoftWrapper(def: ZodDef): boolean {
  return def.type === "optional" || def.type === "default" || def.type === "nullable"
}

/**
 * Emit the schema graph as a plain JSON Schema object. Nodes that cannot be
 * represented (any/unknown/bigint/date, cycles, depth overflow, unknown zod
 * kinds) degrade to the empty schema `{}`, which JSON Schema treats as
 * accepting anything, so conversion never throws.
 */
export function toPortableJsonSchema(schema: unknown): JsonSchemaNode {
  const active = new WeakSet<object>()
  const walk = (node: unknown, depth: number): JsonSchemaNode => {
    if (depth > MAX_DEPTH || typeof node !== "object" || node === null) return {}
    if (active.has(node)) return {}
    const def = zodDef(node)
    if (def === undefined) return {}
    active.add(node)
    const out = emit(def, (child) => walk(child, depth + 1))
    active.delete(node)
    return out
  }
  return walk(schema, 0)
}

/**
 * Emit a zod raw shape (`args`) as an object schema, marking every non-soft
 * field as required. Kept separate so callers never need to wrap the shape in
 * `z.object` before converting.
 */
export function toPortableJsonSchemaForShape(shape: Record<string, unknown>): JsonSchemaNode {
  const properties: Record<string, JsonSchemaNode> = {}
  const required: string[] = []
  for (const [key, value] of Object.entries(shape)) {
    properties[key] = toPortableJsonSchema(value)
    const childDef = zodDef(value)
    if (childDef === undefined || !isSoftWrapper(childDef)) required.push(key)
  }
  const schema: JsonSchemaNode = { type: "object", properties }
  if (required.length > 0) schema.required = required
  return schema
}

function emit(def: ZodDef, walk: (child: unknown) => JsonSchemaNode): JsonSchemaNode {
  switch (def.type) {
    case "string":
      return { type: "string" }
    case "number":
      return { type: "number" }
    case "boolean":
      return { type: "boolean" }
    case "null":
      return { type: "null" }
    case "literal": {
      const value = Array.isArray(def.values) ? def.values[0] : def.value
      return value === undefined ? {} : { const: value }
    }
    case "enum": {
      const values = enumValues(def)
      return values.length > 0 ? { enum: values } : {}
    }
    case "array":
      return { type: "array", items: walk(def.element) }
    case "object":
      return emitObject(def, walk)
    case "record": {
      const schema: JsonSchemaNode = { type: "object" }
      const valueSchema = walk(def.valueType)
      if (Object.keys(valueSchema).length > 0) schema.additionalProperties = valueSchema
      return schema
    }
    case "union": {
      const options = Array.isArray(def.options) ? def.options : []
      return options.length > 0 ? { anyOf: options.map((option) => walk(option)) } : {}
    }
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "brand":
    case "refine":
    case "transform":
      return walk(def.innerType)
    case "lazy":
      return walk(def.getter?.())
    case "unknown":
    case "any":
      return {}
    default:
      // Unknown or exotic kinds (pipe/lazy/date/intersection, ...) cannot be
      // described faithfully; the empty schema keeps the input permissive.
      return {}
  }
}

function enumValues(def: ZodDef): unknown[] {
  const entries = def.entries
  if (typeof entries === "object" && entries !== null) return Object.values(entries as object)
  return Array.isArray(def.values) ? def.values : []
}

function emitObject(def: ZodDef, walk: (child: unknown) => JsonSchemaNode): JsonSchemaNode {
  const shape = def.shape
  if (typeof shape !== "object" || shape === null) {
    const schema: JsonSchemaNode = { type: "object" }
    if (def.catchall !== undefined) schema.additionalProperties = walk(def.catchall)
    return schema
  }
  const properties: Record<string, JsonSchemaNode> = {}
  const required: string[] = []
  for (const [key, value] of Object.entries(shape as Record<string, unknown>)) {
    properties[key] = walk(value)
    const childDef = zodDef(value)
    if (childDef === undefined || !isSoftWrapper(childDef)) required.push(key)
  }
  const schema: JsonSchemaNode = { type: "object", properties }
  if (required.length > 0) schema.required = required
  if (def.catchall !== undefined) {
    const catchallSchema = walk(def.catchall)
    schema.additionalProperties = Object.keys(catchallSchema).length > 0 ? catchallSchema : true
  }
  return schema
}