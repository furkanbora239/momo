// MODIFIED: advertise a small discovery envelope; handlers strictly validate every full operation.
import { z } from "zod"
import { taskInput, consultInput } from "./tool-operation-inputs"

function discoveryInput(actions: string[]) {
  if (actions.length === 0) throw new Error("A native tool must have operations")
  return z.object({
    action: z.enum(actions as [string, ...string[]]),
    operation: z.string().min(1).max(64).optional().describe("For help: select one operation; omit for the index."),
  }).passthrough()
}

export const taskDiscoveryInput = discoveryInput(taskInput.options.map(schema => schema.shape.action.value))
export const consultDiscoveryInput = discoveryInput(consultInput.options.map(schema => schema.shape.action.value))
