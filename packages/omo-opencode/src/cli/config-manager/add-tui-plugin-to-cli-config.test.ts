import { afterEach, describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { PLUGIN_NAME } from "../../shared"
import type { OpenCodeVersionProbe } from "../../shared/opencode-version-probe"
import { ensureTuiPluginEntry } from "./add-tui-plugin-to-tui-config"

const v2Probe: OpenCodeVersionProbe = () => ({ available: true, version: "2.0.24", major: 2 })
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

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe("OpenCode V2 server plugin registration", () => {
  it("keeps the server package in opencode.json plugins and does not create cli.json", () => {
    const dir = tempConfigDir()
    const config = {
      plugins: [PLUGIN_NAME],
      model: "provider/model",
      mcp: { other: { type: "local" } },
    }
    writeConfig(dir, "opencode.json", config)

    const first = ensureTuiPluginEntry({ configDir: dir, versionProbe: v2Probe })
    const second = ensureTuiPluginEntry({ configDir: dir, versionProbe: v2Probe })

    expect(first).toEqual({ changed: false, reason: "already-present" })
    expect(second).toEqual({ changed: false, reason: "already-present" })
    expect(readJson(dir, "opencode.json")).toEqual(config)
    expect(existsSync(join(dir, "cli.json"))).toBe(false)
  })

  it("migrates legacy server registration and preserves unrelated config", () => {
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", {
      plugin: [PLUGIN_NAME],
      model: "provider/model",
      theme: "dark",
    })

    const result = ensureTuiPluginEntry({ configDir: dir, versionProbe: v2Probe })

    expect(result).toEqual({ changed: true, reason: "migrated" })
    expect(readJson(dir, "opencode.json")).toEqual({
      plugins: [PLUGIN_NAME],
      model: "provider/model",
      theme: "dark",
      _migrations: ["2026-09-opencode-v2-plugins"],
    })
    expect(existsSync(join(dir, "cli.json"))).toBe(false)
  })

  it("leaves an existing cli.json untouched because it is not the server plugin registry", () => {
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugins: [PLUGIN_NAME] })
    const cliConfig = { plugins: ["vendor/cli-only-plugin"], theme: "dark" }
    writeConfig(dir, "cli.json", cliConfig)
    const before = readFileSync(join(dir, "cli.json"), "utf8")

    const result = ensureTuiPluginEntry({ configDir: dir, versionProbe: v2Probe })

    expect(result).toEqual({ changed: false, reason: "already-present" })
    expect(readJson(dir, "cli.json")).toEqual(cliConfig)
    expect(readFileSync(join(dir, "cli.json"), "utf8")).toBe(before)
  })

  it("does not report migration success when no server plugin entry exists", () => {
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { model: "provider/model" })

    const result = ensureTuiPluginEntry({ configDir: dir, versionProbe: v2Probe })

    expect(result).toEqual({ changed: false, reason: "no-server-entry" })
    expect(existsSync(join(dir, "cli.json"))).toBe(false)
  })
})
