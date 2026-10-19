import { describe, expect, test } from "bun:test"
import { createOhMyOpenCodeJsonSchema } from "./build-schema-document"

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null
}

describe("build-schema-document", () => {
  test("generates schema with skills property", () => {
    // given
    const expectedDraft = "http://json-schema.org/draft-07/schema#"

    // when
    const schema = createOhMyOpenCodeJsonSchema()

    // then
    expect(schema.$schema).toBe(expectedDraft)
    expect(schema.title).toBe("Oh My OpenCode Configuration")
    expect(isRecord(schema.properties)).toBe(true)
    const properties = isRecord(schema.properties) ? schema.properties : {}
    expect(properties.skills).toBeDefined()
  })
})

test("generated Jev configuration retains authentication and model defaults", () => {
  const schema = createOhMyOpenCodeJsonSchema()
  const properties = isRecord(schema.properties) ? schema.properties : {}
  const manager = isRecord(properties.manager) ? properties.manager : {}
  const managerProperties = isRecord(manager.properties) ? manager.properties : {}
  const jev = isRecord(managerProperties.jev) ? managerProperties.jev : {}
  const fields = isRecord(jev.properties) ? jev.properties : {}
  expect(jev.type).toBe("object")
  expect(fields.provider_id).toBeDefined()
  expect(fields.model).toMatchObject({ default: "jev-1.13-free", type: "string" })
  expect(fields.authentication).toMatchObject({ default: "none", enum: ["provider", "none"] })
})
