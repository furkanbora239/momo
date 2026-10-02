import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { _resetLoggerForTesting } from "../shared/logger"
import { createV1ClientFacade, createV2PluginInput, UNMAPPED_V1_CLIENT_APIS } from "./client-bridge"
import type { V2PluginContext } from "./types"

type RecordedCall = { domain: string; method: string; args: unknown }

function createFakeCtx() {
  const calls: RecordedCall[] = []
  const record = (domain: string, method: string) => (args: unknown) => {
    calls.push({ domain, method, args })
    return undefined
  }
  const ctx = {
    location: {
      directory: "/repo",
      project: { id: "proj-1", directory: "/repo", canonical: "/repo" },
    },
    session: {
      get: async (args: unknown) => {
        calls.push({ domain: "session", method: "get", args })
        return {
          id: "sess-1",
          projectID: "proj-1",
          title: "main",
          time: { created: 100, updated: 200 },
          location: { directory: "/repo" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        }
      },
    },
    provider: { list: record("provider", "list") },
    model: { list: record("model", "list") },
    agent: { list: record("agent", "list") },
  } as unknown as V2PluginContext
  return { ctx, calls }
}

describe("createV2PluginInput", () => {
  it("keeps the V1 plugin input shape grounded in ctx.location", () => {
    // given
    const { ctx } = createFakeCtx()

    // when
    const input = createV2PluginInput(ctx)

    // then
    expect(input.project.id).toBe("proj-1")
    expect(input.project.worktree).toBe("/repo")
    expect(input.directory).toBe("/repo")
    expect(input.worktree).toBe("/repo")
    expect(input.serverUrl).toBeUndefined()
    expect(typeof input.experimental_workspace.register).toBe("function")
    expect(() => input.$`ls`).toThrow("Bun shell is not available under the OpenCode V2 runtime")
    expect(input.client).toBeDefined()
  })
})

describe("createV1ClientFacade", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "v2-client-bridge-test-"))
    _resetLoggerForTesting()
  })

  afterEach(() => {
    _resetLoggerForTesting()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("delegates session.get with the V1 nested shape flattened onto ctx.session.get", async () => {
    // given — call shape copied from tools/call-omo-agent/session-creator.ts
    const { ctx, calls } = createFakeCtx()
    const client = createV1ClientFacade(ctx)

    // when
    const result = await client.session.get({ path: { id: "sess-1" } })

    // then
    expect(calls).toEqual([{ domain: "session", method: "get", args: { sessionID: "sess-1" } }])
    expect(result.error).toBeUndefined()
    expect(result.data?.id).toBe("sess-1")
    expect(result.data?.directory).toBe("/repo")
  })

  it("degrades unmapped domains to a logged no-op resolving undefined", async () => {
    // given — call shape copied from cli/run/runner.ts event subscription
    const logged: { message: string; data: unknown }[] = []
    const logFn = (message: string, data?: unknown) => logged.push({ message, data })
    const { ctx } = createFakeCtx()
    const client = createV1ClientFacade(ctx, logFn)

    // when
    const first = await client.event.subscribe({ query: { directory: "/repo" } })
    const second = await client.event.subscribe({ query: { directory: "/repo" } })

    // then
    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    expect(logged).toHaveLength(1)
    expect(logged[0].message).toBe("[v2-client-bridge] unmapped V1 client API degraded to no-op")
    expect(logged[0].data).toEqual({ api: "event.subscribe" })
  })

  it("degrades unknown methods on mapped domains to a logged no-op instead of a TypeError", async () => {
    // given
    const logged: { message: string; data: unknown }[] = []
    const logFn = (message: string, data?: unknown) => logged.push({ message, data })
    const { ctx } = createFakeCtx()
    const client = createV1ClientFacade(ctx, logFn)

    // when
    const result = await client.session.fork({ path: { id: "sess-1" } })

    // then
    expect(result).toBeUndefined()
    expect(logged).toHaveLength(1)
    expect(logged[0].message).toBe("[v2-client-bridge] unmapped V1 client API degraded to no-op")
    expect(logged[0].data).toEqual({ api: "session.fork" })
  })

  it("keeps tui.showToast as an explicit logged no-op listed in UNMAPPED_V1_CLIENT_APIS", async () => {
    // given — call shape copied from hooks/preemptive-compaction-trigger.ts
    const { ctx } = createFakeCtx()
    const client = createV1ClientFacade(ctx)

    // when
    const result = await client.tui.showToast({
      body: { title: "t", message: "m", variant: "warning", duration: 10000 },
    })

    // then
    expect(result).toBeUndefined()
    expect(UNMAPPED_V1_CLIENT_APIS.map((entry) => entry.api)).toContain("tui.showToast")
    expect(UNMAPPED_V1_CLIENT_APIS.map((entry) => entry.api)).toContain("session.todo")
    expect(UNMAPPED_V1_CLIENT_APIS.map((entry) => entry.api)).toContain("session.status")
  })
})
