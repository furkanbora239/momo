import { expect, test } from "bun:test"
import { installAstGrepForOpenCode } from "./install-ast-grep-sg"

test("prepares only the managed runtime without invoking the legacy package-manager installer", async () => {
  const calls: unknown[] = []
  const options = {
    homeDir: "/isolated/home", platform: "linux" as const, arch: "x64",
    installer: async () => { calls.push("legacy"); return { kind: "failed" as const, reason: "global installers are forbidden" } },
    resolveBinary: () => ({ found: false as const, error: { code: "BINARY_NOT_FOUND" as const, message: "missing", hints: [] } }),
    provision: async (input: { targetDir: string }) => { calls.push(input.targetDir); return input.targetDir + "/sg" },
  }
  await installAstGrepForOpenCode(options)
  expect(calls).toEqual(["/isolated/home/.omo/runtime/ast-grep/linux-x64"])
})
