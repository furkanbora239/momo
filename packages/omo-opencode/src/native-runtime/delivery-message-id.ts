import { createHash } from "node:crypto"

export function deliveryMessageID(taskID: string): string {
  const hex = createHash("sha256").update(`delivery:${taskID}`).digest("hex")
  return `msg_${hex.slice(0, 26)}`
}

export function childrenWakeMessageID(taskID: string, wakeID: string): string {
  return `msg_${createHash("sha256").update(`children-wake:${taskID}:${wakeID}`).digest("hex").slice(0, 26)}`
}
