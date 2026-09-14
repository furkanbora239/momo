import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

const hookModule: typeof import("./hook") = await import("./hook")
const { createCommentCheckerHooks } = hookModule

const processWithCli = mock(async () => {})
const cliRunner = {
  initializeCommentCheckerCli: () => {},
  getCommentCheckerCliPathPromise: () => Promise.resolve("/tmp/fake-comment-checker"),
  isCliPathUsable: () => true,
  processWithCli,
  processApplyPatchEditsWithCli: async () => {},
}
const { stopPendingCallCleanup, takePendingCall } = await import("./pending-calls")
const { _resetCommentCheckerInitializationForTesting } = await import("./initialization-gate")

describe("comment-checker config gating", () => {
  beforeEach(() => {
    processWithCli.mockClear()
    stopPendingCallCleanup()
    _resetCommentCheckerInitializationForTesting()
  })

  afterEach(() => {
    stopPendingCallCleanup()
    _resetCommentCheckerInitializationForTesting()
  })

  it("#given enabled false #when before hook runs #then it registers no pending call and runs no CLI", async () => {
    const hooks = createCommentCheckerHooks({ enabled: false }, cliRunner)
    const input = { tool: "write", sessionID: "ses_test", callID: "call_disabled" }

    await hooks["tool.execute.before"](input, {
      args: { filePath: "/repo/src/write.ts", content: "// comment\n" },
    })
    await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

    expect(takePendingCall("call_disabled")).toBeUndefined()
    expect(processWithCli).toHaveBeenCalledTimes(0)
  })

  it("#given ignore_paths matching the file #when before hook runs #then it skips the file", async () => {
    const hooks = createCommentCheckerHooks(
      { ignore_paths: ["**/*.md", "docs/**"] },
      cliRunner,
    )
    const input = { tool: "write", sessionID: "ses_test", callID: "call_md" }

    await hooks["tool.execute.before"](input, {
      args: { filePath: "docs/readme.md", content: "<!-- comment -->\n" },
    })
    await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

    expect(takePendingCall("call_md")).toBeUndefined()
    expect(processWithCli).toHaveBeenCalledTimes(0)
  })

  it("#given ignore_paths not matching the file #when before and after hooks run #then it still checks", async () => {
    const hooks = createCommentCheckerHooks(
      { ignore_paths: ["**/*.md", "docs/**"] },
      cliRunner,
    )
    const input = { tool: "write", sessionID: "ses_test", callID: "call_ts" }

    await hooks["tool.execute.before"](input, {
      args: { filePath: "src/app.ts", content: "// comment\n" },
    })
    await hooks["tool.execute.after"](input, { title: "ok", output: "Success", metadata: {} })

    expect(takePendingCall("call_ts")).toBeUndefined()
    expect(processWithCli).toHaveBeenCalledTimes(1)
  })
})
