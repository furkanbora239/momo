import { describe, expect, it } from "bun:test"
import { chmodSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { isOllamaInstalled } from "./ollama-installer"

describe("ollama-installer", () => {
  it("returns a boolean for isOllamaInstalled", () => {
    expect(typeof isOllamaInstalled()).toBe("boolean")
  })

  it("detects a system ollama on PATH, not only the ~/.omo local install", () => {
    const stubDir = mkdirSync(join(tmpdir(), `ollama-stub-${Date.now()}`), { recursive: true })
    const stubBin = join(stubDir, "ollama")
    writeFileSync(stubBin, "#!/bin/sh\nexit 0\n", "utf-8")
    chmodSync(stubBin, 0o755)

    const savedPath = process.env["PATH"]
    process.env["PATH"] = `${stubDir}:${savedPath ?? ""}`
    try {
      expect(isOllamaInstalled()).toBe(true)
    } finally {
      if (savedPath === undefined) delete process.env["PATH"]
      else process.env["PATH"] = savedPath
    }
  })
})
