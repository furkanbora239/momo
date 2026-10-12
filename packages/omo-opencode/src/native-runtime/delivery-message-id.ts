import { createHash } from "node:crypto"

export function deliveryMessageID(taskID: string): string {
  const hex = createHash("sha256").update(`delivery:${taskID}`).digest("hex")
  return `msg_${hex.slice(0, 26)}`
}
