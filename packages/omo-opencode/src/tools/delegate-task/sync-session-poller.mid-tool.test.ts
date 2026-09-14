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

function createMidToolClient(): OpencodeClient {
  return unsafeTestValue<OpencodeClient>({
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
      abort: async () => ({ data: {} }),
    },
  })
}

describe("pollSyncSession mid-tool incomplete detection", () => {
  afterEach(() => {
    __resetTimingConfig()
  })

  test("#given assistant text with a pending tool part and no finish #when session status is idle #then poll reports mid_tool_incomplete instead of completion", async () => {
    // given
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MAX_POLL_TIME_MS: 50,
    })
    const client = createMidToolClient()

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_test",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    }, 50)

    // then
    expect(result).not.toBeNull()
    expect(result).toContain("mid_tool_incomplete")
  })

  test("#given mid_tool_incomplete poll error #when the runner classifies it for model fallback #then it is not retryable", async () => {
    // given
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MAX_POLL_TIME_MS: 50,
    })
    const client = createMidToolClient()

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_test",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    }, 50)
    const { shouldRetryError } = await import("@oh-my-opencode/model-core")
    const retryable = shouldRetryError({ message: result ?? "" })

    // then
    expect(retryable).toBe(false)
  })

  test("#given assistant text with only completed turns and no tool parts #when status API is unavailable #then the status fallback completion still works", async () => {
    // given
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MAX_POLL_TIME_MS: 50,
    })
    const client = unsafeTestValue<OpencodeClient>({
      session: {
        messages: async () => ({
          data: [
            {
              info: { id: "msg_001", role: "assistant" },
              parts: [{ type: "text", text: "done" }],
            },
          ],
        }),
        abort: async () => ({ data: {} }),
      },
    })

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_test",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    }, 50)

    // then
    expect(result).toBeNull()
  })
})
