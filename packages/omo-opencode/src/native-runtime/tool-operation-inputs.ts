// MODIFIED: one authoritative native operation schema for validation and discovery.
import { z } from "zod"

export const nativeTaskRoles = ["planner", "executor", "reviewer", "worker", "explore", "librarian", "research", "catalog-researcher"] as const
const pageInput = { offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(10).optional() }
const viewInput = { view: z.enum(["brief", "full"]).optional() }
const inspectionInputs = [
  z.strictObject({ action: z.literal("list"), ...pageInput, includeMaintenance: z.boolean().optional() }),
  z.strictObject({ action: z.literal("candidates"), taskID: z.string(), ...pageInput, role: z.enum([...nativeTaskRoles, "advisor"]).optional(), providerID: z.string().optional() }),
  z.strictObject({ action: z.literal("detail"), taskID: z.string() }),
  z.strictObject({ action: z.literal("result"), taskID: z.string(), offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(16384).optional() }),
] as const
const discoveryInputs = [
  z.strictObject({ action: z.literal("help"), operation: z.string().min(1).max(64).optional() }),
  z.strictObject({ action: z.literal("capabilities") }),
] as const

export const taskInput = z.discriminatedUnion("action", [
  ...inspectionInputs, ...discoveryInputs,
  z.strictObject({ action: z.literal("create"), prompt: z.string().min(1), scope: z.string().optional(), acceptance: z.string().optional(), waitMs: z.number().int().min(1_000).max(60_000).optional(), ...viewInput }),
  z.strictObject({ action: z.literal("status"), taskID: z.string(), ...viewInput }),
  z.strictObject({ action: z.literal("wait"), taskID: z.string(), timeoutMs: z.number().int().min(1_000).max(60_000).optional(), ...viewInput }),
  z.strictObject({ action: z.literal("select"), taskID: z.string(), decisionId: z.string(), role: z.enum(nativeTaskRoles), providerID: z.string(), modelID: z.string(), ...viewInput }),
  z.strictObject({ action: z.literal("resume"), taskID: z.string(), ...viewInput }),
  z.strictObject({ action: z.literal("answer"), taskID: z.string(), questionID: z.string(), answer: z.unknown(), ...viewInput }),
  z.strictObject({ action: z.literal("cancel"), taskID: z.string(), ...viewInput }),
])

export const consultInput = z.discriminatedUnion("action", [
  ...inspectionInputs, ...discoveryInputs,
  z.strictObject({ action: z.literal("start"), prompt: z.string().min(1), scope: z.string().optional(), waitMs: z.number().int().min(1_000).max(60_000).optional(), ...viewInput }),
  z.strictObject({ action: z.literal("select"), taskID: z.string(), decisionId: z.string(), providerID: z.string(), modelID: z.string(), ...viewInput }),
  z.strictObject({ action: z.literal("status"), taskID: z.string(), ...viewInput }),
  z.strictObject({ action: z.literal("wait"), taskID: z.string(), timeoutMs: z.number().int().min(1_000).max(60_000).optional(), ...viewInput }),
])
