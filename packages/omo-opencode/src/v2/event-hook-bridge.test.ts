import { describe, expect, it } from "bun:test"
import { createV2EventToV1Mapper, registerEventHook } from "./event-hook-bridge"
import { createLogOnce, createRegistrationCollector } from "./registration-collector"
import { createHookBridgeTestHarness, syntheticHandlers } from "./hook-bridge.test-support"

describe("createV2EventToV1Mapper", () => {
  const seenKeys = new Set<string>()
  const logOnceKeys: string[] = []
  const logOnce = createLogOnce("mapper-test")
  const countingLogOnce = (key: string, message: string, context?: Record<string, unknown>) => {
    if (seenKeys.has(key)) return
    seenKeys.add(key)
    logOnceKeys.push(key)
    logOnce(key, message, context)
  }

  it("maps the V1 event kinds momo consumes", () => {
    // given
    const map = createV2EventToV1Mapper(countingLogOnce)

    // when + then
    expect(map({ type: "session.idle", created: 1, data: { sessionID: "sess-1" } } as never)).toEqual({
      type: "session.idle",
      properties: { sessionID: "sess-1" },
    })
    expect(map({ type: "session.status", created: 1, data: { sessionID: "sess-1", status: { type: "busy" } } } as never)).toEqual({
      type: "session.status",
      properties: { sessionID: "sess-1", status: { type: "busy" } },
    })
    const errorEvent = map({
      type: "session.execution.failed",
      created: 1,
      data: { sessionID: "sess-1", error: { type: "http", message: "boom" } },
    } as never)
    expect(errorEvent?.type).toBe("session.error")
    expect((errorEvent as { properties: { error: { name: string } } }).properties.error.name).toBe("UnknownError")
  })

  it("skips unmapped V2 kinds with a log-once per kind", () => {
    // given
    const map = createV2EventToV1Mapper(countingLogOnce)
    const before = logOnceKeys.length

    // when
    expect(map({ type: "session.text.delta", created: 1, data: { sessionID: "s" } } as never)).toBeUndefined()
    expect(map({ type: "session.text.delta", created: 2, data: { sessionID: "s" } } as never)).toBeUndefined()

    // then
    expect(logOnceKeys.length).toBe(before + 1)
  })
})

describe("registerEventHook", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  it("dispatches mapped V2 events to the V1 event handler and skips unmapped kinds", async () => {
    // given
    const harness = createHookBridgeTestHarness({
      events: [
        { type: "session.idle", created: 1, data: { sessionID: "sess-1" } },
        { type: "session.text.delta", created: 2, data: { sessionID: "sess-1", delta: "x" } },
      ],
    })
    const collector = createRegistrationCollector()
    const received: string[] = []

    // when
    await registerEventHook(harness.ctx, {
      ...syntheticHandlers(),
      event: async (input) => {
        received.push(input.event.type)
      },
    } as unknown as Parameters<typeof registerEventHook>[1], collector)
    await sleep(15)

    // then — mapped kinds reach the handler, unmapped kinds are skipped
    expect(received).toEqual(["session.idle"])

    // when
    harness.pushEvent({ type: "session.compaction.ended", created: 3, data: { sessionID: "sess-1" } })
    await sleep(15)

    // then
    expect(received).toEqual(["session.idle", "session.compacted"])
  })

  it("aborts the subscription loop when the collected registration disposes", async () => {
    // given
    const harness = createHookBridgeTestHarness()
    const collector = createRegistrationCollector()

    // when
    await registerEventHook(harness.ctx, syntheticHandlers(), collector)
    await sleep(15)
    expect(harness.getSubscribeSignal()?.aborted).toBe(false)
    await collector.disposeAll()
    await sleep(15)

    // then
    expect(harness.getSubscribeSignal()?.aborted).toBe(true)
  })
})
