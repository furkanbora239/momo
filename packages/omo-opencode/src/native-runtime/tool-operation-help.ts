// MODIFIED: selective tool help generated from the runtime validation schemas.
import { createHash } from "node:crypto"
import { z } from "zod"
import type { NativeTaskRole } from "../native-task"
import { nativeToolAllowed, type NativeAgentID } from "./role-policy"
import { taskInput, consultInput } from "./tool-operation-inputs"

export type NativeLifecycleTool = "momo_task" | "momo_consult"
const schemas = { momo_task: taskInput, momo_consult: consultInput }
const docs: Record<string, string> = {
  help: "Load this operation index or one current input schema; cache by contractVersion.",
  capabilities: "Inspect current role permissions, consultation availability and question support.",
  create: "Delegate bounded implementation or investigation with scope and acceptance criteria.",
  start: "Request distilled advice; requires an eligible configured advisor. It does not delegate implementation.",
  list: "Recover owned task IDs. Follow nextOffset until absent; maintenance is opt-in.",
  candidates: "Page current caller choices after awaiting_selection; reuse the task and decision IDs.",
  detail: "Inspect assignment and structured question keys/options before answering.",
  result: "Page a saved result when resultTruncated is true; nextOffset uses string indices.",
  status: "Inspect current state. view: brief omits repeated detail; full remains the default.",
  wait: "Wait once for a bounded interval. view: brief reduces output. Timeout may return a nonterminal task.",
  select: "Choose an offered eligible model using the existing task and decision IDs.",
  resume: "Continue an interrupted task in its existing native session, preserving the assignment.",
  answer: "Answer the matching pending question in the same child task; no task recreation is required.",
  cancel: "Cancel this owned task and its managed descendants; inspect the returned state.",
}
const examples: Partial<Record<NativeLifecycleTool, Record<string, Record<string, unknown>>>> = {
  momo_task: {
    answer: { action: "answer", taskID: "task-id", questionID: "question-id", answer: { field_key: "chosen_value" }, view: "brief" },
    wait: { action: "wait", taskID: "task-id", timeoutMs: 1000, view: "brief" },
  },
  momo_consult: { start: { action: "start", prompt: "Review the proposed fix and identify the main risk.", view: "brief" } },
}
const serialized = JSON.stringify(Object.fromEntries(Object.entries(schemas).map(([tool, schema]) => [tool, z.toJSONSchema(schema)])))
export const nativeToolContractVersion = `native-tools-v1:${createHash("sha256").update(serialized).update(JSON.stringify(docs)).update(JSON.stringify(examples)).digest("hex").slice(0, 16)}`

export interface NativeToolHelp {
  tool: NativeLifecycleTool
  contractVersion: string
  action?: string
  description?: string
  inputSchema?: z.core.JSONSchema.JSONSchema
  example?: Record<string, unknown>
  error?: { code: string; operation?: string }
  operations?: { action: string; description: string | undefined }[]
  protocol?: {
    resultEncoding: string
    decodeOnce: string
    questions: { available: boolean; askTool: string; answerTool: string; answerAction: string; purpose: string }
    consultation: { tool: string; action: string; requiresAdvisorPool: boolean; useFor: string }
    monitoring: { view: string; timeoutDoesNotCancel: boolean; retryCreation: boolean; acceptance: string }
  }
}

export function describeNativeTool(input: { tool: NativeLifecycleTool; role: NativeTaskRole; operation?: string }): NativeToolHelp {
  const base = { tool: input.tool, contractVersion: nativeToolContractVersion }
  const agent = `momo-${input.role}` as NativeAgentID
  if (!nativeToolAllowed(agent, input.tool)) return { ...base, error: { code: "tool_not_allowed" }, operations: [] }
  const options = schemas[input.tool].options
  const operations = options.map(schema => ({ action: schema.shape.action.value, description: docs[schema.shape.action.value] }))
  if (input.operation !== undefined) {
    const selected = options.find(schema => schema.shape.action.value === input.operation)
    if (!selected) return { ...base, error: { code: "unknown_operation", operation: input.operation }, operations }
    return { ...base, action: input.operation, description: docs[input.operation], inputSchema: z.toJSONSchema(selected), example: examples[input.tool]?.[input.operation] }
  }
  return {
    ...base, operations,
    protocol: {
      resultEncoding: "json-string",
      decodeOnce: "JSON.parse(await tools.momo_task(input)) or JSON.parse(await tools.momo_consult(input))",
      questions: {
        available: input.role !== "catalog-researcher" && input.role !== "advisor",
        askTool: "question", answerTool: "momo_task", answerAction: "answer",
        purpose: "Missing input or a blocker: ask instead of reporting unperformed work as completed.",
      },
      consultation: { tool: "momo_consult", action: "start", requiresAdvisorPool: true, useFor: "Expert advice from a different eligible model." },
      monitoring: { view: "brief", timeoutDoesNotCancel: true, retryCreation: false, acceptance: "Execution success does not prove acceptance." },
    },
  }
}
