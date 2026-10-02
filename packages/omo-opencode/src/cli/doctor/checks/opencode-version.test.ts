import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { OpenCodeVersionProbe } from "../../../shared/opencode-version-probe"
import { checkOpenCodeVersion } from "./opencode-version"

const tempDirs: string[] = []

function tempConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-doctor-opencode-version-"))
  tempDirs.push(dir)
  return dir
}

function probeOf(version: string | null): OpenCodeVersionProbe {
  const major = version === null ? null : Number((/^v?(\d+)/.exec(version) ?? [])[1])
  return () => ({ available: version !== null, version, major: Number.isNaN(major) ? null : major })
}

function writeConfig(dir: string, name: string, value: unknown): void {
  writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n", "utf-8")
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe("checkOpenCodeVersion", () => {
  it("#given a V1 opencode with the legacy plugin key #when checked #then it passes and reports the server() mode", async () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: ["oh-my-openagent"] })

    // when
    const result = await checkOpenCodeVersion({ configDir: dir, versionProbe: probeOf("1.18.34") })

    // then
    expect(result.status).toBe("pass")
    expect(result.issues).toEqual([])
    expect(result.details).toContain("opencode: 1.18.34 (V1)")
    expect(result.details).toContain("plugin registration: server() (V1)")
    expect(result.details).toContain("plugin key: plugin (V1)")
  })

  it("#given a V2 opencode with the plugins key #when checked #then it passes and reports the setup() mode", async () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugins: [{ package: "oh-my-openagent", options: {} }] })

    // when
    const result = await checkOpenCodeVersion({ configDir: dir, versionProbe: probeOf("2.0.1") })

    // then
    expect(result.status).toBe("pass")
    expect(result.issues).toEqual([])
    expect(result.details).toContain("opencode: 2.0.1 (V2)")
    expect(result.details).toContain("plugin registration: setup() (V2)")
    expect(result.details).toContain("plugins key: plugins (V2)")
  })

  it("#given a V2 opencode with only the legacy plugin key #when checked #then it warns with the exact fix", async () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: ["oh-my-openagent"] })

    // when
    const result = await checkOpenCodeVersion({ configDir: dir, versionProbe: probeOf("2.0.1") })

    // then
    expect(result.status).toBe("warn")
    expect(result.issues).toHaveLength(1)
    const issue = result.issues[0]
    expect(issue?.severity).toBe("warning")
    expect(issue?.title).toBe("opencode config still uses the V1 plugin key")
    expect(issue?.description).toContain('"plugins"')
    expect(issue?.fix).toContain('Rename "plugin" to "plugins"')
    expect(issue?.fix).toContain('{"package": path, "options": {...}}')
    expect(issue?.fix).toContain("npx oh-my-openagent install")
  })

  it("#given a V2 opencode with both keys #when checked #then it still warns about the legacy key", async () => {
    // given
    const dir = tempConfigDir()
    writeConfig(dir, "opencode.json", { plugin: ["oh-my-openagent"], plugins: ["other/plugin"] })

    // when
    const result = await checkOpenCodeVersion({ configDir: dir, versionProbe: probeOf("2.0.1") })

    // then
    expect(result.status).toBe("warn")
    expect(result.issues).toHaveLength(1)
  })

  it("#given no detectable opencode version #when checked #then it skips without issues", async () => {
    // given
    const dir = tempConfigDir()

    // when
    const result = await checkOpenCodeVersion({ configDir: dir, versionProbe: probeOf(null) })

    // then
    expect(result.status).toBe("skip")
    expect(result.issues).toEqual([])
    expect(result.details).toContain("opencode: not detected (unknown)")
    expect(result.details).toContain("plugin registration: server() (V1)")
  })

  it("#given a V1 opencode with no config file #when checked #then it passes without config details", async () => {
    // given
    const dir = tempConfigDir()

    // when
    const result = await checkOpenCodeVersion({ configDir: dir, versionProbe: probeOf("1.18.34") })

    // then
    expect(result.status).toBe("pass")
    expect(result.details).not.toContain("config:")
  })
})
