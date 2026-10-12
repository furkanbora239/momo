import { describe, expect, it } from "bun:test"
import { waitForNativeCompletion } from "./completion"
import type { NativeOpenCodeClient } from "./types"
import { deliveryMessageID } from "../../native-runtime/delivery-message-id"

type EventValue = { type: string; created?: number; data: { sessionID: string; delta?: string } }

function createEventQueue() {
  const queue: EventValue[] = []
  let wake: (() => void) | undefined
  const iterable = {
    [Symbol.asyncIterator]() {
      return {
        next: async (): Promise<IteratorResult<EventValue>> => {
          while (queue.length === 0) await new Promise<void>((resolve) => { wake = resolve })
          return { done: false, value: queue.shift() as EventValue }
        },
        return: async (): Promise<IteratorResult<EventValue>> => ({ done: true, value: undefined }),
      }
    },
  }
  return {
    iterable,
    push(event: EventValue) {
      queue.push(event)
      wake?.()
      wake = undefined
    },
  }
}

function snapshotClient(queue: ReturnType<typeof createEventQueue>, rootSessionID: string): { client: NativeOpenCodeClient; setConsumed(value: boolean): void } {
  let reads = 0
  let consumed = false
  const client = {
    event: { subscribe: () => queue.iterable },
    rpc: { call: async () => {
      reads += 1
      const state = reads === 1 ? "running" : "succeeded"
      const delivery = reads === 1 ? "pending" : "delivered"
      return { output: { tasks: [
        { id: "child", state, rootSessionID, parentSessionID: rootSessionID, delivery: { status: delivery, messageID: deliveryMessageID("child"), ...(delivery === "delivered" ? { attemptedAt: 19, deliveredAt: 40 } : {}) } },
      ] } }
    } },
    session: {
      context: async () => [
        { id: deliveryMessageID("child"), type: "synthetic", time: { created: 20 }, text: "child result" },
        ...(consumed ? [{ id: "root-answer", type: "assistant", time: { created: 25, completed: 30 }, content: [] }] : []),
      ],
      active: async () => ({}),
      inbox: { list: async () => [] },
    },
  } as unknown as NativeOpenCodeClient
  return { client, setConsumed(value: boolean) { consumed = value } }
}

describe("native run completion", () => {
  it("waits for a root turn after newly delivered child work", async () => {
    const queue = createEventQueue()
    const controller = new AbortController()
    const snapshot = snapshotClient(queue, "root")
    const pending = waitForNativeCompletion({
      client: snapshot.client,
      directory: "/workspace",
      sessionID: "root",
      signal: controller.signal,
      json: true,
      verbose: false,
      timestamp: false,
      initialTasks: [],
    })
    queue.push({ type: "session.execution.started", created: 1, data: { sessionID: "root" } })
    queue.push({ type: "session.execution.succeeded", created: 10, data: { sessionID: "root" } })
    let complete = false
    void pending.then(() => { complete = true })
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(complete).toBe(false)
    snapshot.setConsumed(true)
    queue.push({ type: "session.execution.started", created: 20, data: { sessionID: "root" } })
    queue.push({ type: "session.execution.succeeded", created: 30, data: { sessionID: "root" } })
    const result = await pending
    expect(result).not.toBe(130)
    if (result === 130) throw new Error("unexpected abort result")
    expect(result.success).toBe(true)
    expect(result.tasks[0]?.delivery).toBe("delivered")
  })

  it("keeps a post-enqueue aggregation success when delivery persistence arrives late", async () => {
    const queue = createEventQueue()
    const controller = new AbortController()
    const snapshot = snapshotClient(queue, "root")
    snapshot.setConsumed(true)
    const completion = waitForNativeCompletion({
      client: snapshot.client,
      directory: "/workspace",
      sessionID: "root",
      signal: controller.signal,
      json: true,
      verbose: false,
      timestamp: false,
      initialTasks: [],
    })
    queue.push({ type: "session.execution.started", created: 20, data: { sessionID: "root" } })
    queue.push({ type: "session.execution.succeeded", created: 30, data: { sessionID: "root" } })
    const result = await completion
    expect(result).not.toBe(130)
    if (result === 130) throw new Error("unexpected abort result")
    expect(result.success).toBe(true)
  })

  it("does not wait for nested task deliveries in the root session context", async () => {
    const queue = createEventQueue()
    const controller = new AbortController()
    const client = {
      event: { subscribe: () => queue.iterable },
      rpc: { call: async () => ({ output: { tasks: [
        { id: "root-child", state: "succeeded", rootSessionID: "root", parentSessionID: "root", delivery: { status: "delivered", messageID: deliveryMessageID("root-child") } },
        { id: "nested-child", state: "succeeded", rootSessionID: "root", parentSessionID: "department", delivery: { status: "delivered", messageID: deliveryMessageID("nested-child") } },
      ] } }) },
      session: {
        context: async () => [{ id: deliveryMessageID("root-child"), type: "synthetic", time: { created: 20 }, text: "root child result" }, { id: "aggregate", type: "assistant", time: { completed: 30 }, content: [] }],
        active: async () => ({}),
        inbox: { list: async () => [] },
      },
    } as unknown as NativeOpenCodeClient
    const completion = waitForNativeCompletion({ client, directory: "/workspace", sessionID: "root", signal: controller.signal, json: true, verbose: false, timestamp: false, initialTasks: [{ id: "root-child", state: "succeeded", parentSessionID: "root", delivery: "delivered" }] })
    queue.push({ type: "session.execution.succeeded", created: 30, data: { sessionID: "root" } })
    const result = await completion
    expect(result).not.toBe(130)
    if (result === 130) throw new Error("unexpected abort result")
    expect(result.success).toBe(true)
    expect(result.tasks).toHaveLength(2)
  })
})
