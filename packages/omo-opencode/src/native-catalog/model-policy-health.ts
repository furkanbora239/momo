import { mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { NativeModelRejection } from "./model-continuity-evidence"
import { z } from "zod"
import { parseNativeQuotaFailure, type NativeQuotaFailure } from "./model-quota-evidence"
import type { NativeModelRef } from "../native-routing/types"

const entrySchema = z.object({
  model: z.object({ providerID: z.string(), id: z.string() }),
  reason: z.enum(["observed_privacy_policy_rejection", "observed_free_quota_limit", "observed_rate_limit", "observed_model_payment_required", "observed_provider_payment_required"]),
  quota: z.object({ type: z.literal("provider.free-limit"), status: z.literal(429), retryAfterMs: z.number().positive().finite().max(86_400_000) }).optional(),
  scope: z.enum(["model", "provider"]).optional(),
  observedAt: z.number(), unavailableUntil: z.number(), taskID: z.string(), sessionID: z.string(),
  failureID: z.string().optional(),
  observedFailures: z.array(z.string()).optional(),
})
const schema = z.object({ version: z.literal(1), entries: z.array(entrySchema) })
export type NativeModelPolicyFailure = z.infer<typeof entrySchema>

export function isNativePrivacyPolicyRejection(message: string): boolean {
  return /trains on request data/i.test(message) && /privacy settings/i.test(message)
}

/** Only native provider failures enter this store. Model output is never evidence. */
export function createNativeModelPolicyHealth(file: string, options: { now?: () => number; ttlMs?: number } = {}) {
  const now = options.now ?? Date.now
  let writes = Promise.resolve()
  const key = (model: NativeModelRef) => JSON.stringify([model.providerID, model.id])
  async function read(): Promise<Map<string, NativeModelPolicyFailure>> {
    try {
      const parsed = schema.parse(JSON.parse(await readFile(file, "utf8")))
      return new Map(parsed.entries.map((entry) => [entry.scope === "provider" ? JSON.stringify([entry.model.providerID]) : key(entry.model), entry]))
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") return new Map()
      throw error
    }
  }
  async function persist(entries: Map<string, NativeModelPolicyFailure>) {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 })
    const temporary = `${file}.${crypto.randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify({ version: 1, entries: [...entries.values()] }), { mode: 0o600 })
    await rename(temporary, file)
  }
  return {
    async observe(model: NativeModelRef, failure: { message: string; taskID: string; sessionID: string; failureID: string; occurredAt?: number; quota?: NativeQuotaFailure; rejection?: NativeModelRejection }): Promise<boolean> {
      // OpenCode's observed Go rejection identifies training on request data and Privacy settings.
      const quota = parseNativeQuotaFailure(failure.quota)
      const rejection = failure.rejection
      if (!quota && !rejection && !isNativePrivacyPolicyRejection(failure.message)) return false
      if ((quota || rejection) && (failure.occurredAt === undefined || !Number.isFinite(failure.occurredAt) || failure.occurredAt <= 0 || failure.occurredAt > now())) return false
      const operation = writes.then(async () => {
        const entries = await read()
        const scope = rejection?.scope ?? "model"
        const entryKey = scope === "provider" ? JSON.stringify([model.providerID]) : key(model)
        const existing = entries.get(entryKey)
        const identity = JSON.stringify([failure.taskID, failure.sessionID, failure.failureID])
        const observedFailures = existing?.observedFailures ?? (existing ? [JSON.stringify([existing.taskID, existing.sessionID, existing.failureID ?? "legacy"])] : [])
        if (observedFailures.includes(identity)) return
        const observedAt = failure.occurredAt ?? now()
        const unavailableUntil = observedAt + (quota?.retryAfterMs ?? rejection?.retryAfterMs ?? options.ttlMs ?? 3_600_000)
        if (existing && (unavailableUntil <= existing.unavailableUntil)) {
          entries.set(entryKey, { ...existing, observedFailures: [...observedFailures, identity] })
          await persist(entries)
          return
        }
        const reason = quota ? "observed_free_quota_limit"
          : rejection?.kind === "rate_limit" ? "observed_rate_limit"
          : rejection?.kind === "payment_required" ? scope === "provider" ? "observed_provider_payment_required" : "observed_model_payment_required"
          : "observed_privacy_policy_rejection"
        entries.set(entryKey, { model, reason, ...(scope === "provider" ? { scope } : {}), ...(quota ? { quota } : {}), observedAt, unavailableUntil, taskID: failure.taskID, sessionID: failure.sessionID, failureID: failure.failureID, observedFailures: [...observedFailures, identity] })
        await persist(entries)
      })
      writes = operation.catch(() => undefined)
      await operation
      return true
    },
    async get(model: NativeModelRef): Promise<NativeModelPolicyFailure | undefined> {
      await writes
      const entries = await read()
      const provider = entries.get(JSON.stringify([model.providerID]))
      if (provider && now() < provider.unavailableUntil) return provider
      const entry = entries.get(key(model))
      return entry && now() < entry.unavailableUntil ? entry : undefined
    },
    async list(): Promise<NativeModelPolicyFailure[]> {
      await writes
      return [...(await read()).values()].filter((entry) => now() < entry.unavailableUntil)
    },
  }
}
export type NativeModelPolicyHealth = ReturnType<typeof createNativeModelPolicyHealth>
