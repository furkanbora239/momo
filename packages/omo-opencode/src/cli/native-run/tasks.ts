import type { NativeOpenCodeClient } from "./types"

export type RootTaskSnapshot = {
  id: string
  state: string
  rootSessionID?: string
  parentSessionID?: string
  delivery?: string
  deliveryMessageID?: string
  deliveryAt?: number
  sourceDecisionID?: string
}

export async function readRootTasks(client: NativeOpenCodeClient, directory: string, rootSessionID: string): Promise<RootTaskSnapshot[]> {
  let response: unknown
  try {
    response = await client.rpc.call({
      rpcID: "momo.native",
      method: "tasks",
      location: { directory },
      input: { rootSessionID },
    })
  } catch (error) {
    throw new Error(`OpenCode native task RPC momo.native/tasks is unavailable; the momo native plugin entry must be loaded. ${error instanceof Error ? error.message : String(error)}`)
  }
  const output = isRecord(response) && "output" in response ? response.output : response
  const payload = isRecord(output) && "tasks" in output ? output.tasks : output
  if (!Array.isArray(payload)) throw new Error("OpenCode native task RPC returned an invalid tasks payload")
  return payload.map(readTask)
}

export function areRootTasksDelivered(tasks: readonly RootTaskSnapshot[]): boolean {
  const terminal = new Set(["succeeded", "failed", "cancelled"])
  return tasks.filter(isUserTask).every((task) => terminal.has(task.state) && task.delivery === "delivered")
}

export function userJobTasks(tasks: readonly RootTaskSnapshot[]): RootTaskSnapshot[] {
  return tasks.filter(isUserTask)
}

function readTask(value: unknown): RootTaskSnapshot {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.state !== "string") {
    throw new Error("OpenCode native task RPC returned a malformed task record")
  }
  const delivery = isRecord(value.delivery) && typeof value.delivery.status === "string" ? value.delivery.status : undefined
  const deliveryMessageID = isRecord(value.delivery) && typeof value.delivery.messageID === "string" ? value.delivery.messageID : undefined
  const deliveryAt = isRecord(value.delivery) && typeof value.delivery.deliveredAt === "number" ? value.delivery.deliveredAt : undefined
  const sourceDecisionID = typeof value.sourceDecisionID === "string" ? value.sourceDecisionID : undefined
  const rootSessionID = typeof value.rootSessionID === "string" ? value.rootSessionID : undefined
  const parentSessionID = typeof value.parentSessionID === "string" ? value.parentSessionID : undefined
  return {
    id: value.id,
    state: value.state,
    ...(rootSessionID !== undefined ? { rootSessionID } : {}),
    ...(parentSessionID !== undefined ? { parentSessionID } : {}),
    ...(delivery !== undefined ? { delivery } : {}),
    ...(deliveryMessageID !== undefined ? { deliveryMessageID } : {}),
    ...(deliveryAt !== undefined ? { deliveryAt } : {}),
    ...(sourceDecisionID !== undefined ? { sourceDecisionID } : {}),
  }
}

function isUserTask(task: RootTaskSnapshot): boolean {
  return task.sourceDecisionID === undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
