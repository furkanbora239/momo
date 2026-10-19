import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { dirname } from "node:path"
import { z } from "zod"
import type { NativeModelRef, NativeResearchContext } from "../native-routing/types"

const model = z.object({ providerID: z.string(), id: z.string() })
const entry = z.object({ model, executor: model.optional(), context: z.object({ decisionId: z.string(), rootSessionID: z.string(), parentSessionID: z.string(), parentRole: z.string() }), status: z.enum(["paused", "queued", "running", "completed", "failed"]), reason: z.string().optional(), taskID: z.string().optional(), updatedAt: z.number() })
const schema = z.object({ version: z.literal(1), entries: z.array(entry) })
export type NativeResearchMaintenanceEntry = z.infer<typeof entry>

/** Durable, selected-model-only maintenance. Missing facts never hold a user route. */
export function createNativeResearchMaintenance(file: string, options: {
  executor?: NativeModelRef
  getExecutor?: () => Promise<NativeModelRef | undefined>
  isTargetEligible?: (model: NativeModelRef) => Promise<boolean>
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
      const assignedExecutor = item.executor ?? (options.getExecutor ? undefined : options.executor)
      if (state === "interrupted" && options.resume && assignedExecutor && !await options.isBusy() && await options.isEligible(assignedExecutor)) {
        await options.resume(item.taskID, item.context as NativeResearchContext)
        state = await options.inspect(item.taskID)
      }
      const known = state === "succeeded" && await options.hasKnowledge(item.model)
      await mutate(async (entries) => {
        const current = entries.find((candidate) => same(candidate.model, item.model))
        if (!current || current.status !== "running") return
        if (state === "interrupted" && !assignedExecutor && options.getExecutor) { current.status = "failed"; current.reason = "research_executor_unknown" }
        else if (state === "succeeded") { current.status = known ? "completed" : "failed"; current.reason = known ? undefined : "research_finished_without_verified_knowledge" }
        else if (["failed", "cancelled", "awaiting_selection", "waiting_question"].includes(state ?? "")) { current.status = "failed"; current.reason = `research_${state}` }
        else if (state === undefined) { current.status = "paused"; current.reason = "research_launch_uncertain" }
        current.updatedAt = now()
      })
    }
    if (await options.isBusy()) return
    const entries = await load()
    if (entries.some((item) => item.status === "running")) return
    let next: NativeResearchMaintenanceEntry | undefined
    let known = false
    for (const item of entries) {
      if (item.status !== "queued" && (item.status !== "paused" || item.reason === "research_launch_uncertain")) continue
      known = await options.hasKnowledge(item.model)
      if (!known && options.isTargetEligible && !await options.isTargetEligible(item.model)) {
        await mutate(async (current) => {
          const target = current.find((candidate) => same(candidate.model, item.model))
          if (target && (target.status === "queued" || target.status === "paused")) {
            target.status = "paused"; target.reason = "target_unavailable"; target.updatedAt = now()
          }
        })
        continue
      }
      next = item
      break
    }
    if (!next) return
    const targetModel = next.model
    const selectedExecutor = known ? undefined : options.executor ?? await options.getExecutor?.()
    const executor = selectedExecutor && { providerID: selectedExecutor.providerID, id: selectedExecutor.id }
    const eligible = executor && await options.isEligible(executor)
    let reserved: NativeResearchMaintenanceEntry | undefined
    await mutate(async (current) => {
      const item = current.find((candidate) => same(candidate.model, targetModel))
      if (!item || current.some((candidate) => candidate.status === "running")) return
      item.updatedAt = now()
      if (known) { item.status = "completed"; item.reason = undefined; return }
      if (!executor || !eligible) { item.status = "paused"; item.reason = executor ? "executor_ineligible" : "executor_unbound"; return }
      item.status = "running"
      item.executor = executor
      item.taskID = `ntask_maintenance_${createHash("sha256").update(JSON.stringify([file, item.context.rootSessionID, item.model.providerID, item.model.id])).digest("hex").slice(0, 24)}`
      item.reason = "launch_pending"
      reserved = structuredClone(item)
    })
    if (!reserved || !executor) return
    let reason: string | undefined
    try {
      const task = await options.create({ model: reserved.model, context: reserved.context as NativeResearchContext, executor, taskID: reserved.taskID! })
      if (task.state === "failed" || task.state === "awaiting_selection") reason = "research_dispatch_failed"
    } catch (error) { reason = error instanceof Error ? error.message : String(error) }
    await mutate(async (current) => {
      const item = current.find((candidate) => same(candidate.model, targetModel))
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
        const bound = options.executor || options.getExecutor
        entries.push({ model, context, status: bound ? "queued" : "paused", reason: bound ? undefined : "executor_unbound", updatedAt: now() })
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
