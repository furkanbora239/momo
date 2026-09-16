import { describe, expect, it } from "bun:test"

import { OhMyOpenCodeConfigSchema } from "../../config/schema/oh-my-opencode-config"
import {
  SETTINGS_DEFINITIONS,
  formatSettingValue,
  nextBooleanValue,
  nextEnumValue,
  readSettingValue,
  settingBaseValue,
  settingId,
} from "./settings-definitions"

const enumDefinitions = SETTINGS_DEFINITIONS.filter((entry) => entry.kind === "enum")

function nestedConfig(path: readonly string[], value: unknown): Record<string, unknown> {
  const root: Record<string, unknown> = {}
  let node = root
  for (const [index, segment] of path.entries()) {
    if (index === path.length - 1) {
      node[segment] = value
      continue
    }
    const child: Record<string, unknown> = {}
    node[segment] = child
    node = child
  }
  return root
}

describe("SETTINGS_DEFINITIONS", () => {
  it("#given every definition default value #when parsed against the root config schema #then it validates", () => {
    for (const definition of SETTINGS_DEFINITIONS) {
      const config = nestedConfig(definition.path, definition.defaultValue)
      const result = OhMyOpenCodeConfigSchema.safeParse(config)
      expect(result.success).toBe(true)
    }
  })

  it("#given a wrong-typed value for a boolean setting #when parsed #then the schema rejects it", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse(
      nestedConfig(["catalog", "enabled"], "yes"),
    )
    expect(result.success).toBe(false)
  })

  it("#given a wrong-typed value for a number setting #when parsed #then the schema rejects it", () => {
    const result = OhMyOpenCodeConfigSchema.safeParse(
      nestedConfig(["local_translator", "min_length"], "twenty"),
    )
    expect(result.success).toBe(false)
  })

  it("#given every enum definition #when parsed against the schema #then each allowed member validates and a foreign member fails", () => {
    expect(enumDefinitions.length).toBeGreaterThan(0)
    for (const definition of enumDefinitions) {
      const values = definition.allowedValues ?? []
      for (const value of values) {
        const result = OhMyOpenCodeConfigSchema.safeParse(nestedConfig(definition.path, value))
        expect(result.success).toBe(true)
      }
      const invalid = OhMyOpenCodeConfigSchema.safeParse(
        nestedConfig(definition.path, "__not_an_option__"),
      )
      expect(invalid.success).toBe(false)
    }
  })

  it("#given definition paths #when converted to ids #then they are unique dotted keys", () => {
    const ids = SETTINGS_DEFINITIONS.map(settingId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe("readSettingValue", () => {
  const config = { catalog: { enabled: false }, local_translator: { mode: "local" } }

  it("#given a set path #when walked #then it reports present with the value", () => {
    expect(readSettingValue(config, ["catalog", "enabled"])).toEqual({ present: true, value: false })
  })

  it("#given a missing path #when walked #then it reports absent", () => {
    expect(readSettingValue(config, ["catalog", "missing"]).present).toBe(false)
  })

  it("#given a path through a non-object #when walked #then it reports absent", () => {
    expect(readSettingValue({ catalog: true } as Record<string, unknown>, ["catalog", "enabled"]).present).toBe(false)
  })
})

describe("settingBaseValue", () => {
  const definition = SETTINGS_DEFINITIONS[0]
  if (definition === undefined) throw new Error("definitions required")

  it("#given a pending value #when resolving the base #then the pending value wins", () => {
    expect(settingBaseValue(definition, true, false, true)).toBe(true)
  })

  it("#given no pending and a present current #when resolving the base #then the current wins", () => {
    expect(settingBaseValue(definition, true, false, undefined)).toBe(false)
  })

  it("#given no pending and a missing current #when resolving the base #then the definition default wins", () => {
    expect(settingBaseValue(definition, false, undefined, undefined)).toBe(definition.defaultValue)
  })
})

describe("nextEnumValue", () => {
  it("#given a member of the allowed values #when cycled #then it advances with wraparound", () => {
    const mode = enumDefinitions[0]
    if (mode === undefined) throw new Error("enum definitions required")
    expect(nextEnumValue(mode, "cloud")).toBe("local")
    expect(nextEnumValue(mode, "local")).toBe("cloud")
  })

  it("#given a value outside the allowed set #when cycled #then it starts at the first member", () => {
    const mode = enumDefinitions[0]
    if (mode === undefined) throw new Error("enum definitions required")
    expect(nextEnumValue(mode, "__unknown__")).toBe("cloud")
  })
})

describe("nextBooleanValue and formatSettingValue", () => {
  it("#given a boolean #when toggled #then it flips", () => {
    expect(nextBooleanValue(true)).toBe(false)
    expect(nextBooleanValue(false)).toBe(true)
  })

  it("#given values of each kind #when formatted #then booleans numbers strings render and missing renders the default label", () => {
    expect(formatSettingValue(true)).toBe("true")
    expect(formatSettingValue(20)).toBe("20")
    expect(formatSettingValue("local")).toBe("local")
    expect(formatSettingValue(undefined)).toBe("(default)")
  })
})
