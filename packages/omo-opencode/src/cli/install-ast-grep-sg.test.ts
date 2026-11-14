/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { join } from "node:path"

import { installAstGrepForOpenCode } from "./install-ast-grep-sg"

describe("installAstGrepForOpenCode", () => {
  test("#given OpenCode install finished #when ast-grep provisioning runs #then it targets the OMO runtime directory", async () => {
    // given
    const calls: Array<{ readonly targetDir: string }> = []

    // when
    await installAstGrepForOpenCode({
      homeDir: "/home/test",
      resolveBinary: () => ({ found: false, error: { code: "BINARY_NOT_FOUND", message: "missing", hints: [] } }),
      provision: async (input) => {
        calls.push({ targetDir: input.targetDir })
        return join(input.targetDir, "sg")
      },
      arch: "x64",
      platform: "linux",
    })

    // then
    expect(calls).toEqual([{ targetDir: join("/home/test", ".omo", "runtime", "ast-grep", "linux-x64") }])
  })

  test("#given managed download fails #when OpenCode installer calls it #then installation continues without throwing", async () => {
    // given
    const logs: string[] = []

    // when
    await expect(installAstGrepForOpenCode({
      homeDir: "/home/test",
      resolveBinary: () => ({ found: false, error: { code: "BINARY_NOT_FOUND", message: "missing", hints: [] } }),
      provision: async () => { throw new Error("offline") },
      log: (message) => logs.push(message),
      arch: "x64",
      platform: "linux",
    })).resolves.toBeUndefined()

    // then
    expect(logs.join("\n")).toContain("offline")
  })
})
