import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PLUGIN_NAME } from "../../shared"
import type { OpenCodeVersionProbe } from "../../shared/opencode-version-probe"
import { ensureTuiPluginEntry } from "./add-tui-plugin-to-tui-config"

const v2Probe: OpenCodeVersionProbe = () => ({ available: true, version: "2.0.1", major: 2 })
const v1Probe: OpenCodeVersionProbe = () => ({ available: true, version: "1.18.34", major: 1 })

const tempDirs: string[] = []

function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-cli-config-"))
  tempDirs.push(dir)
  return dir
}

function writeConfig(dir: string, name: string, value: unknown): void {
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n", "utf-8")
}

function readJson(dir: string, name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, name), "utf-8")) as Record<string, unknown>
}

function writeFilePackage(dir: string, name = PLUGIN_NAME): string {
  const packageDir = join(dir, "package")
  mkdirSync(packageDir, { recursive: true })
  writeConfig(packageDir, "package.json", { name, exports: { ".": "./dist/index.js", "./tui": "./dist/tui.js" } })
  return `file:${packageDir}`
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("ensureTuiPluginEntry under OpenCode V2", () => {
  it("#given a V2 plugins server entry and no cli.json #when ensuring #then it creates cli.json with the object-form entry", () => {
    // given
    const dir = tempConfigDir()
    const fileEntry = writeFilePackage(dir)
    writeConfig(dir, "opencode.json", { plugins: [{ package: fileEntry, options: { theme: "dark" } }] })

    // when
    const first = ensureTuiPluginEntry({ configDir: dir, versionProbe: v2Probe })
    const second = ensureTuiPluginEntry({ configDir: dir, versionProbe: v2Probe })

    // then
    expect(first).toEqual({ changed: true, reason: "added" })
    expect(second).toEqual({ changed: false, reason: "already-present" })
    expect(readJson(dir, "cli.json")).toEqual({
      plugins: [{ package: fileEntry, options: { theme: "dark" } }],
    })
  })

  it("#given an existing cli.json with foreign entries #when ensuring #then other entries are preserved and momo is appended once", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugins: [PLUGIN_NAME] })
    writeConfig(dir, "cli.json", {
      plugins: ["some-other/tui", { package: "vendor/panel", options: { side: "left" } }],
      theme: "dark",
    })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir, versionProbe: v2Probe })

    // then
    expect(result).toEqual({ changed: true, reason: "added" })
    expect(readJson(dir, "cli.json")).toEqual({
      plugins: [
        "some-other/tui",
        { package: "vendor/panel", options: { side: "left" } },
        { package: PLUGIN_NAME, options: {} },
      ],
      theme: "dark",
    })
  })

  it("#given a cli.json already holding the desired momo entry with custom options #when ensuring #then it is left untouched", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugins: [PLUGIN_NAME] })
    writeConfig(dir, "cli.json", {
      plugins: [{ package: PLUGIN_NAME, options: { sidebar: true } }],
    })
    const before = readFileSync(join(dir, "cli.json"), "utf-8")

    // when
    const result = ensureTuiPluginEntry({ configDir: dir, versionProbe: v2Probe })

    // then
    expect(result).toEqual({ changed: false, reason: "already-present" })
    expect(readFileSync(join(dir, "cli.json"), "utf-8")).toBe(before)
  })

  it("#given a stale momo entry in cli.json #when ensuring #then it is replaced by the desired entry", () => {
    // given
    const dir = tempConfigDir()
    const fileEntry = writeFilePackage(dir)
    writeConfig(dir, "opencode.json", { plugins: [{ package: `${fileEntry}/dist/index.js` }] })
    writeConfig(dir, "cli.json", { plugins: [`${PLUGIN_NAME}/tui`, "keep/me"] })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir, versionProbe: v2Probe })

    // then
    expect(result).toEqual({ changed: true, reason: "added" })
    expect(readJson(dir, "cli.json")).toEqual({
      plugins: ["keep/me", { package: fileEntry, options: {} }],
    })
  })

  it("#given a malformed cli.json #when ensuring #then the original file is preserved and no temp is left", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugins: [PLUGIN_NAME] })
    writeFileSync(join(dir, "cli.json"), "{bad json", "utf-8")

    // when
    const result = ensureTuiPluginEntry({ configDir: dir, versionProbe: v2Probe })

    // then
    expect(result).toEqual({ changed: false, reason: "malformed" })
    expect(readFileSync(join(dir, "cli.json"), "utf-8")).toBe("{bad json")
    expect(existsSync(join(dir, "cli.json.tmp"))).toBe(false)
  })

  it("#given a cli.json with a non-array plugins key #when ensuring #then it does not clobber the value", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugins: [PLUGIN_NAME] })
    writeConfig(dir, "cli.json", { plugins: "broken" })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir, versionProbe: v2Probe })

    // then
    expect(result).toEqual({ changed: false, reason: "malformed" })
    expect(readJson(dir, "cli.json")).toEqual({ plugins: "broken" })
  })

  it("#given a legacy V1 plugin server entry under V2 #when ensuring #then opencode.json is migrated to plugins and cli.json gets the entry", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: [PLUGIN_NAME], theme: "dark" })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir, versionProbe: v2Probe })

    // then
    expect(result).toEqual({ changed: true, reason: "added" })
    expect(readJson(dir, "opencode.json")).toEqual({
      plugins: [PLUGIN_NAME],
      theme: "dark",
      _migrations: ["2026-09-opencode-v2-plugins"],
    })
    expect(readJson(dir, "cli.json")).toEqual({
      plugins: [{ package: PLUGIN_NAME, options: {} }],
    })
  })

  it("#given a legacy V1 plugin server entry without a momo registration #when ensuring under V2 #then the key is migrated but no cli entry is written", () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: ["other/plugin"] })

    // when
    const result = ensureTuiPluginEntry({ configDir: dir, versionProbe: v2Probe })

    // then
    expect(result).toEqual({ changed: true, reason: "migrated" })
    expect(readJson(dir, "opencode.json")).toEqual({
      plugins: ["other/plugin"],
      _migrations: ["2026-09-opencode-v2-plugins"],
    })
    expect(existsSync(join(dir, "cli.json"))).toBe(false)
  })

  it("#given the same setup #when comparing probes #then V1 writes tui.json and V2 writes cli.json", () => {
    // given
    const v1Dir = tempConfigDir()
    const v2Dir = tempConfigDir()
    for (const dir of [v1Dir, v2Dir]) {
      writeConfig(dir, "opencode.json", { plugin: [PLUGIN_NAME] })
    }

    // when
    const v1Result = ensureTuiPluginEntry({ configDir: v1Dir, versionProbe: v1Probe })
    const v2Result = ensureTuiPluginEntry({ configDir: v2Dir, versionProbe: v2Probe })

    // then
    expect(v1Result).toEqual({ changed: true, reason: "added" })
    expect(v2Result).toEqual({ changed: true, reason: "added" })
    expect(existsSync(join(v1Dir, "tui.json"))).toBe(true)
    expect(existsSync(join(v1Dir, "cli.json"))).toBe(false)
    expect(existsSync(join(v2Dir, "tui.json"))).toBe(false)
    expect(existsSync(join(v2Dir, "cli.json"))).toBe(true)
  })
})
