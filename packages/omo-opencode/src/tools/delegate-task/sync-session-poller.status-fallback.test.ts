/// <reference types="bun-types" />
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

describe("pollSyncSession FLAVOR-1 completion gating", () => {
  afterEach(() => {
    __resetTimingConfig()
  })

  test("#given absent status map AND mid-flight opening narration #when polling #then keeps waiting and does NOT declare completion", async () => {
    // given: opencode v2 has no session.status API, so the status map is absent.
    // The child has only emitted its OPENING narration (text, no finish, no tool).
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MAX_POLL_TIME_MS: 50,
    })
    const client = unsafeTestValue<OpencodeClient>({
      session: {
        // No status() method => status map absent: absence is UNKNOWN.
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 } },
              parts: [{ type: "text", text: "Let me investigate this..." }],
            },
          ],
        }),
        abort: async () => ({ data: {} }),
      },
    })

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_ef9bffc22ffeTooqqiPXI3HDxN",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    }, 50)

    // then: absence of status must NOT be inferred as completion; the loop keeps
    // waiting within the inactivity window and reports a timeout, never "Task completed".
    expect(result).not.toBeNull()
    expect(result).toContain("Poll inactivity timeout")
    expect(result).not.toContain("Task completed")
  })

  test("#given status map present AND idle AND a finalized final message with no pending tool #when polling #then completion is reported", async () => {
    // given: positive idle confirmation (status present, non-active) plus a
    // finalized, tool-free final assistant message.
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      MAX_POLL_TIME_MS: 5000,
    })
    const client = unsafeTestValue<OpencodeClient>({
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "stop" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        }),
        status: async () => ({ data: { ses_test: { type: "idle" } } }),
        abort: async () => ({ data: {} }),
      },
    })

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_test",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    })

    // then: genuine finish is still reported as completion (null)
    expect(result).toBeNull()
  })

  test("#given absent status map AND a finalized complete message #when the inactivity window settles #then completion is still reported (status fallback)", async () => {
    // given: status API unavailable (v2). The final message IS finalized and
    // tool-free, but absence is UNKNOWN, so completion must wait for the
    // inactivity window to elapse with no new activity before being trusted.
    __setTimingConfig({
      POLL_INTERVAL_MS: 1,
      STALL_TIMEOUT_MS: 30,
      MAX_POLL_TIME_MS: 5000,
    })
    const client = unsafeTestValue<OpencodeClient>({
      session: {
        messages: async () => ({
          data: [
            { info: { id: "msg_001", role: "user", time: { created: 1000 } } },
            {
              info: { id: "msg_002", role: "assistant", time: { created: 2000 }, finish: "stop" },
              parts: [{ type: "text", text: "Done" }],
            },
          ],
        }),
        abort: async () => ({ data: {} }),
      },
    })

    // when
    const result = await pollSyncSession(toolContext, client, {
      sessionID: "ses_missing_status",
      agentToUse: "sisyphus",
      toastManager: null,
      taskId: undefined,
    })

    // then: after the settle window with no new activity, the completed message
    // is trusted and reported as completion (null).
    expect(result).toBeNull()
  })
})
