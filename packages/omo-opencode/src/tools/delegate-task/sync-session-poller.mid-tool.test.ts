import { afterEach, describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { pollSyncSession } from "./sync-session-poller"
import { __resetTimingConfig, __setTimingConfig } from "./timing"
import type { OpencodeClient, ToolContextWithMetadata } from "./types"

const toolContext: ToolContextWithMetadata = {
  sessionID: "ses_parent",
  messageID: "msg_parent",
  agent: "sisyphus",
  abort: new AbortController().signal,
}

function createMidToolClient(): { client: OpencodeClient; abortCalls: () => number } {
  let abortCount = 0
  const client = unsafeTestValue<OpencodeClient>({
    session: {
      messages: async () => ({
        data: [
          { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
          {
            info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
            parts: [
              { type: "text", text: "let me update the repo..." },
              { type: "tool", tool: "edit", state: { status: "running" } },
            ],
          },
        ],
      }),
      status: async () => ({ data: { ses_test: { type: "idle" } } }),
      abort: async () => {
        abortCount++
        return { data: {} }
      },
    },
  })
  return { client, abortCalls: () => abortCount }
}

describe("pollSyncSession FLAVOR-2 pending-tool wait loop", () => {
  afterEach(() => {
    __resetTimingConfig()
  })

  test("#given assistant text with a pending tool part #when within the inactivity window #then poll keeps waiting instead of reporting mid_tool_incomplete", async () => {
    // given: the model narrated BETWEEN tool calls (normal interleave). Status is
    // idle and the tool is still pending, but the window has not expired.
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MAX_POLL_TIME_MS: 50,
    })
    const { client } = createMidToolClient()

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_ef9bffc21ffeBEwUszKQ9eCthO",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    }, 50)

    // then: text-with-pending-tool continues polling; it is NOT a verdict.
    expect(result).not.toBeNull()
    expect(result).toContain("Poll inactivity timeout")
    expect(result).not.toContain("mid_tool_incomplete")
  })

  test("#given assistant text with a pending tool part that never resolves #when the inactivity window expires #then reports incomplete/stall (abort path intact)", async () => {
    // given: genuinely stuck session - text present, tool pending, no tool result
    // ever arrives. The stall window is tiny so the test completes quickly.
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      STALL_TIMEOUT_MS: 40,
      MAX_POLL_TIME_MS: 5000,
    })
    const { client, abortCalls } = createMidToolClient()

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_test",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    }, 5000)

    // then: the abort/stall safeguard still fires once the window expires, and
    // task_id resume remains the fallback for the genuinely stuck session.
    expect(abortCalls()).toBeGreaterThanOrEqual(1)
    expect(result).toContain("mid_tool_incomplete")
    expect(result).toContain("task_id")
  })

  test("#given mid_tool_incomplete poll error #when the runner classifies it for model fallback #then it is not retryable", async () => {
    // given: the stuck-session scenario above produces a mid_tool_incomplete verdict
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      STALL_TIMEOUT_MS: 40,
      MAX_POLL_TIME_MS: 5000,
    })
    const { client } = createMidToolClient()

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_test",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    }, 5000)
    const { shouldRetryError } = await import("@oh-my-opencode/model-core")
    const retryable = shouldRetryError({ message: result ?? "" })

    // then
    expect(retryable).toBe(false)
  })
})
