import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { z } from "zod"
import type { NativeTask, NativeTaskRepository } from "./types"

const modelSchema = z.object({ providerID: z.string().min(1), id: z.string().min(1) })
const roleSchema = z.enum(["orchestrator", "planner", "executor", "reviewer", "worker", "explore", "librarian", "research", "catalog-researcher", "advisor"])
const candidateSchema = z.object({ role: roleSchema, model: modelSchema }).passthrough()
const taskSchema = z.object({
  id: z.string().min(1), rootTaskID: z.string().min(1), parentTaskID: z.string().optional(),
  rootSessionID: z.string().min(1), parentSessionID: z.string().min(1), sessionID: z.string().optional(),
  kind: z.enum(["task", "consultation"]), parentRole: roleSchema, role: roleSchema.optional(), model: modelSchema.optional(),
  requiredRole: roleSchema.optional(), sourceDecisionID: z.string().optional(), maintenance: z.literal(true).optional(),
  decisionId: z.string().optional(), candidates: z.array(candidateSchema).optional(),
  usage: z.object({ inputTokens: z.number(), outputTokens: z.number(), scope: z.literal("session_cumulative") }).optional(),
  usageError: z.string().optional(),
  state: z.enum(["awaiting_selection", "queued", "running", "waiting_question", "waiting_children", "succeeded", "failed", "cancelled", "interrupted"]),
  prompt: z.string(), scope: z.string().optional(), acceptance: z.string().optional(),
  createdAt: z.number(), updatedAt: z.number(), attempts: z.number().int().nonnegative(), progress: z.string().optional(),
  activeTools: z.array(z.object({ id: z.string(), name: z.string(), startedAt: z.number() })),
  question: z.object({ id: z.string(), prompt: z.string(), options: z.array(z.string()).optional(), form: z.record(z.string(), z.unknown()).optional() }).optional(),
  questionDelivery: z.enum(["pending", "sent"]).optional(), questionDeadlineAt: z.number().optional(), questionEscalated: z.boolean().optional(),
  answer: z.unknown().optional(), answerStatus: z.enum(["pending", "sent"]).optional(), childrenWakePending: z.boolean().optional(), parentWakeID: z.string().optional(), waitForTaskID: z.string().optional(), resumeInPlace: z.boolean().optional(),
  executionOutcome: z.object({ state: z.enum(["succeeded", "failed"]), result: z.string().optional(), error: z.string().optional() }).optional(),
  childTaskIDs: z.array(z.string()), result: z.string().optional(), error: z.string().optional(),
  delivery: z.object({ status: z.enum(["pending", "delivered"]), messageID: z.string().optional(), attemptedAt: z.number().optional(), deliveredAt: z.number().optional(), attempts: z.number().int().nonnegative(), lastError: z.string().optional() }).optional(),
  lastExecutionSequence: z.number().int().nonnegative().optional(),
  processedEventIDs: z.array(z.string()), lastActivityAt: z.number(),
}).passthrough()
const storeSchema = z.object({ version: z.literal(1), tasks: z.array(taskSchema) })

export function createFileNativeTaskRepository(filePath: string): NativeTaskRepository {
  const tasks = new Map<string, NativeTask>()
  let initialization: Promise<void> | undefined
  let writes: Promise<void> = Promise.resolve()

  async function initialize(): Promise<void> {
    if (initialization !== undefined) return initialization
    initialization = readStore()
    return initialization
  }

  async function readStore(): Promise<void> {
    let content: string
    try { content = await readFile(filePath, "utf8") } catch (error) {
      if (isMissingFile(error)) return
      throw error
    }
    let parsed: unknown
    try { parsed = JSON.parse(content) } catch (error) {
      throw new Error(`Native task store ${filePath} contains invalid JSON: ${messageOf(error)}`)
    }
    const result = storeSchema.safeParse(parsed)
    if (!result.success) throw new Error(`Native task store ${filePath} is invalid: ${result.error.message}`)
    for (const task of result.data.tasks) {
      if (tasks.has(task.id)) throw new Error(`Native task store ${filePath} has duplicate task ID ${task.id}`)
      tasks.set(task.id, task as NativeTask)
    }
  }

  async function persist(): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true })
    const temporary = `${filePath}.${globalThis.crypto.randomUUID()}.tmp`
    const body = JSON.stringify({ version: 1, tasks: [...tasks.values()] }, null, 2)
    try {
      await writeFile(temporary, body, { encoding: "utf8", mode: 0o600 })
      await rename(temporary, filePath)
    } catch (error) {
      throw new Error(`Could not persist native task store ${filePath}: ${messageOf(error)}`)
    }
  }

  return {
    async get(taskID) {
      await initialize()
      await writes
      const task = tasks.get(taskID)
      return task === undefined ? undefined : structuredClone(task)
    },
    async list() {
      await initialize()
      await writes
      return [...tasks.values()].map((task) => structuredClone(task))
    },
    async save(task) {
      await initialize()
      const operation = writes.then(async () => {
        const previous = tasks.get(task.id)
        tasks.set(task.id, structuredClone(task))
        try { await persist() } catch (error) {
          if (previous === undefined) tasks.delete(task.id)
          else tasks.set(task.id, previous)
          throw error
        }
      })
      writes = operation.then(() => undefined, () => undefined)
      await operation
    },
  }
}

function isMissingFile(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT"
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
