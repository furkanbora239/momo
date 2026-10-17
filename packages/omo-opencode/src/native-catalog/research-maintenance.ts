import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { dirname } from "node:path"
import { z } from "zod"
import type { NativeModelRef, NativeResearchContext } from "../native-routing/types"

const model = z.object({ providerID: z.string(), id: z.string() })
const entry = z.object({ model, context: z.object({ decisionId: z.string(), rootSessionID: z.string(), parentSessionID: z.string(), parentRole: z.string() }), status: z.enum(["paused", "queued", "running", "completed", "failed"]), reason: z.string().optional(), taskID: z.string().optional(), updatedAt: z.number() })
const schema = z.object({ version: z.literal(1), entries: z.array(entry) })
export type NativeResearchMaintenanceEntry = z.infer<typeof entry>

/** Durable, selected-model-only maintenance. Missing facts never hold a user route. */
export function createNativeResearchMaintenance(file: string, options: {
  executor?: NativeModelRef
  isEligible(model: NativeModelRef): Promise<boolean>
  isBusy(): Promise<boolean>
  create(input: { model: NativeModelRef; context: NativeResearchContext; executor: NativeModelRef; taskID: string }): Promise<{ id: string; state: string }>
  resume?(taskID: string, context: NativeResearchContext): Promise<void>
  inspect(taskID: string): Promise<string | undefined>
  hasKnowledge(model: NativeModelRef): Promise<boolean>
  now?: () => number
}) {
  const now = options.now ?? Date.now
  let mutations = Promise.resolve()
  let pumping: Promise<void> | undefined
  async function load(): Promise<NativeResearchMaintenanceEntry[]> {
    try { return schema.parse(JSON.parse(await readFile(file, "utf8"))).entries }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return []
      throw error
    }
  }
  async function save(entries: NativeResearchMaintenanceEntry[]): Promise<void> {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    const temporary = `${file}.${crypto.randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify({ version: 1, entries }), { mode: 0o600 })
    await rename(temporary, file)
  }
  function mutate(operation: (entries: NativeResearchMaintenanceEntry[]) => Promise<void>): Promise<void> {
    const pending = mutations.then(async () => { const entries = await load(); await operation(entries); await save(entries) })
    mutations = pending.catch(() => undefined)
    return pending
  }
  const same = (left: NativeModelRef, right: NativeModelRef) => left.providerID === right.providerID && left.id === right.id
  async function pumpOnce(): Promise<void> {
    // External catalog/runtime operations must never hold the durable storage lock.
    for (const item of await load()) {
      if (!item.taskID || item.status !== "running") continue
      let state = await options.inspect(item.taskID)
      if (state === "interrupted" && options.resume && options.executor && !await options.isBusy() && await options.isEligible(options.executor)) {
        await options.resume(item.taskID, item.context as NativeResearchContext)
        state = await options.inspect(item.taskID)
      }
      const known = state === "succeeded" && await options.hasKnowledge(item.model)
      await mutate(async (entries) => {
        const current = entries.find((candidate) => same(candidate.model, item.model))
        if (!current || current.status !== "running") return
        if (state === "succeeded") { current.status = known ? "completed" : "failed"; current.reason = known ? undefined : "research_finished_without_verified_knowledge" }
        else if (["failed", "cancelled", "awaiting_selection", "waiting_question"].includes(state ?? "")) { current.status = "failed"; current.reason = `research_${state}` }
        else if (state === undefined) { current.status = "paused"; current.reason = "research_launch_uncertain" }
        current.updatedAt = now()
      })
    }
    if (await options.isBusy()) return
    const entries = await load()
    if (entries.some((item) => item.status === "running")) return
    const next = entries.find((item) => item.status === "queued" || (item.status === "paused" && item.reason !== "research_launch_uncertain"))
    if (!next) return
    const known = await options.hasKnowledge(next.model)
    const eligible = options.executor && await options.isEligible(options.executor)
    let reserved: NativeResearchMaintenanceEntry | undefined
    await mutate(async (current) => {
      const item = current.find((candidate) => same(candidate.model, next.model))
      if (!item || current.some((candidate) => candidate.status === "running")) return
      item.updatedAt = now()
      if (known) { item.status = "completed"; item.reason = undefined; return }
      if (!options.executor || !eligible) { item.status = "paused"; item.reason = options.executor ? "executor_ineligible" : "executor_unbound"; return }
      item.status = "running"
      item.taskID = `ntask_maintenance_${createHash("sha256").update(JSON.stringify([file, item.context.rootSessionID, item.model.providerID, item.model.id])).digest("hex").slice(0, 24)}`
      item.reason = "launch_pending"
      reserved = structuredClone(item)
    })
    if (!reserved || !options.executor) return
    let reason: string | undefined
    try {
      const task = await options.create({ model: reserved.model, context: reserved.context as NativeResearchContext, executor: options.executor, taskID: reserved.taskID! })
      if (task.state === "failed" || task.state === "awaiting_selection") reason = "research_dispatch_failed"
    } catch (error) { reason = error instanceof Error ? error.message : String(error) }
    await mutate(async (current) => {
      const item = current.find((candidate) => same(candidate.model, next.model))
      if (!item) return
      item.reason = reason
      if (reason) item.status = "failed"
      item.updatedAt = now()
    })
  }
  return {
    async enqueue(model: NativeModelRef, context: NativeResearchContext): Promise<void> {
      await mutate(async (entries) => {
        if (entries.some((item) => same(item.model, model))) return
        entries.push({ model, context, status: options.executor ? "queued" : "paused", reason: options.executor ? undefined : "executor_unbound", updatedAt: now() })
      })
    },
    async pump(): Promise<void> {
      pumping ??= pumpOnce().finally(() => { pumping = undefined })
      return pumping
    },
    async list(): Promise<NativeResearchMaintenanceEntry[]> { await mutations; return load() },
  }
}
export type NativeResearchMaintenance = ReturnType<typeof createNativeResearchMaintenance>
