import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import {
  OPENCODE_V2_PLUGIN_MIGRATION_ID,
  applyOpenCodeV2PluginMigration,
  transformOpenCodeV2Plugins,
} from "./opencode-v2-plugins"

describe("transformOpenCodeV2Plugins", () => {
  it("#given string plugin entries #when transformed #then they stay strings under plugins", () => {
    // given
    const document = { $schema: "https://example.com/schema.json", plugin: ["oh-my-openagent", "file:/repo/momo"] }

    // when
    const result = transformOpenCodeV2Plugins(document)

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.document).toEqual({
      $schema: "https://example.com/schema.json",
      plugins: ["oh-my-openagent", "file:/repo/momo"],
    })
    expect(Object.hasOwn(result.document, "plugin")).toBe(false)
  })

  it("#given tuple plugin entries #when transformed #then they become package/options objects", () => {
    // given
    const document = {
      plugin: [
        ["./plugin/local.ts", { enabled: true }],
        ["./plugin/bare.ts"],
      ],
    }

    // when
    const result = transformOpenCodeV2Plugins(document)

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.document).toEqual({
      plugins: [
        { package: "./plugin/local.ts", options: { enabled: true } },
        { package: "./plugin/bare.ts" },
      ],
    })
  })

  it("#given an existing plugins array #when transformed #then existing entries win and duplicates are skipped with diagnostics", () => {
    // given
    const document = {
      plugin: ["oh-my-openagent", "file:/repo/momo", ["./plugin/local.ts", { a: 1 }]],
      plugins: [{ package: "oh-my-openagent", options: { keep: true } }, "other/plugin"],
    }

    // when
    const result = transformOpenCodeV2Plugins(document)

    // then
    expect(result.document).toEqual({
      plugins: [
        { package: "oh-my-openagent", options: { keep: true } },
        "other/plugin",
        "file:/repo/momo",
        { package: "./plugin/local.ts", options: { a: 1 } },
      ],
    })
    expect(result.diagnostics).toEqual([
      'skipped: plugin[0] legacy="oh-my-openagent" kept={"package":"oh-my-openagent","options":{"keep":true}}',
    ])
  })

  it("#given a non-object options tuple #when transformed #then the options are dropped with a conflict diagnostic", () => {
    // given
    const document = { plugin: [["./plugin/local.ts", "not-an-object"]] }

    // when
    const result = transformOpenCodeV2Plugins(document)

    // then
    expect(result.document).toEqual({ plugins: [{ package: "./plugin/local.ts" }] })
    expect(result.diagnostics).toEqual([
      'conflict: plugin[0] dropped non-object options "not-an-object" kept package="./plugin/local.ts"',
    ])
  })

  it("#given a non-array plugin key #when transformed #then the document is left unchanged with a conflict diagnostic", () => {
    // given
    const document = { plugin: "oh-my-openagent" }

    // when
    const result = transformOpenCodeV2Plugins(document)

    // then
    expect(result.document).toEqual({ plugin: "oh-my-openagent" })
    expect(result.diagnostics).toEqual(['conflict: plugin expected an array, left unchanged ("oh-my-openagent")'])
  })

  it("#given a non-array plugins key alongside plugin #when transformed #then both keys are kept unchanged", () => {
    // given
    const document = { plugin: ["oh-my-openagent"], plugins: "broken" }

    // when
    const result = transformOpenCodeV2Plugins(document)

    // then
    expect(result.document).toEqual({ plugin: ["oh-my-openagent"], plugins: "broken" })
    expect(result.diagnostics).toEqual(['conflict: plugins expected an array, plugin kept unchanged ("broken")'])
  })

  it("#given a document without a plugin key #when transformed #then it is returned untouched without diagnostics", () => {
    // given
    const document = { theme: "dark", plugins: ["other/plugin"] }

    // when
    const result = transformOpenCodeV2Plugins(document)

    // then
    expect(result.diagnostics).toEqual([])
    expect(result.document).toEqual(document)
  })

  it("#given a non-object document #when transformed #then the result is an empty document", () => {
    expect(transformOpenCodeV2Plugins("nope").document).toEqual({})
    expect(transformOpenCodeV2Plugins(null).document).toEqual({})
  })
})

describe("applyOpenCodeV2PluginMigration", () => {
  const tempDirs: string[] = []

  function tempDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "omo-v2-plugin-migration-"))
    tempDirs.push(dir)
    return dir
  }

  function writeConfig(dir: string, name: string, value: unknown): string {
    const path = join(dir, name)
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf-8")
    return path
  }

  it("#given a V1 plugin config file #when applied #then it renames the key, stamps the marker, and reports migrated", () => {
    // given
    const path = writeConfig(tempDir(), "opencode.json", { plugin: ["oh-my-openagent"], theme: "dark" })

    // when
    const result = applyOpenCodeV2PluginMigration(path)
    const document = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>

    // then
    expect(result).toEqual({ changed: true, reason: "migrated", diagnostics: [] })
    expect(document).toEqual({
      theme: "dark",
      plugins: ["oh-my-openagent"],
      _migrations: [OPENCODE_V2_PLUGIN_MIGRATION_ID],
    })
    expect(existsSync(`${path}.tmp`)).toBe(false)
  })

  it("#given an already migrated file #when applied again #then it is a no-op", () => {
    // given
    const path = writeConfig(tempDir(), "opencode.json", {
      plugins: ["oh-my-openagent"],
      _migrations: [OPENCODE_V2_PLUGIN_MIGRATION_ID],
    })
    const before = readFileSync(path, "utf-8")

    // when
    const result = applyOpenCodeV2PluginMigration(path)

    // then
    expect(result).toEqual({ changed: false, reason: "already-migrated", diagnostics: [] })
    expect(readFileSync(path, "utf-8")).toBe(before)
  })

  it("#given a file without a plugin key #when applied #then it reports unchanged without writing", () => {
    // given
    const path = writeConfig(tempDir(), "opencode.json", { theme: "dark" })
    const before = readFileSync(path, "utf-8")

    // when
    const result = applyOpenCodeV2PluginMigration(path)

    // then
    expect(result).toEqual({ changed: false, reason: "unchanged", diagnostics: [] })
    expect(readFileSync(path, "utf-8")).toBe(before)
  })

  it("#given a malformed config file #when applied #then it reports malformed and preserves the original", () => {
    // given
    const dir = tempDir()
    const path = join(dir, "opencode.json")
    writeFileSync(path, "{bad json", "utf-8")

    // when
    const result = applyOpenCodeV2PluginMigration(path)

    // then
    expect(result.changed).toBe(false)
    expect(result.reason).toBe("malformed")
    expect(readFileSync(path, "utf-8")).toBe("{bad json")
  })

  it("#given a missing file #when applied #then it reports unchanged", () => {
    // given
    const path = join(tempDir(), "missing.json")

    // when
    const result = applyOpenCodeV2PluginMigration(path)

    // then
    expect(result).toEqual({ changed: false, reason: "unchanged", diagnostics: [] })
  })
})
