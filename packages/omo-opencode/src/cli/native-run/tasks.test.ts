import { describe, expect, it } from "bun:test"
import { areRootTasksDelivered, readRootTasks } from "./tasks"
import type { NativeOpenCodeClient } from "./types"

function clientWith(output: unknown): NativeOpenCodeClient {
  return {
    rpc: { call: async () => ({ output }) },
  } as unknown as NativeOpenCodeClient
}

describe("native run task completion", () => {
  it("reads the native root task snapshot and waits for durable delivery", async () => {
    const tasks = await readRootTasks(clientWith({ tasks: [
      { id: "task-1", state: "succeeded", delivery: { status: "pending", attempts: 1 } },
      { id: "task-2", state: "running" },
    ] }), "/workspace", "root-session")

    expect(areRootTasksDelivered(tasks)).toBe(false)
    expect(areRootTasksDelivered([
      { id: "task-1", state: "succeeded", delivery: "delivered" },
      { id: "task-2", state: "failed", delivery: "delivered" },
      { id: "task-3", state: "cancelled", delivery: "delivered" },
    ])).toBe(true)
    expect(areRootTasksDelivered([{ id: "task-4", state: "waiting_question", delivery: "delivered" }])).toBe(false)
  })

  it("fails explicitly when the native task RPC is absent or malformed", async () => {
    await expect(readRootTasks(clientWith({ tasks: [{ id: "broken" }] }), "/workspace", "root-session"))
      .rejects.toThrow("malformed task record")
    const missing = { rpc: { call: async () => { throw new Error("method not found") } } } as unknown as NativeOpenCodeClient
    await expect(readRootTasks(missing, "/workspace", "root-session")).rejects.toThrow("native task RPC momo.native/tasks is unavailable")
  })
})
