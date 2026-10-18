import { usageFromAttempts } from "./jev-http-usage"
import type { NativeJevHttpAttempt } from "./types"
import type { NativeJevAnswer } from "./types"

export type NativeJevUsage = NonNullable<NativeJevAnswer["usage"]>

export function jevUsage(value: unknown): NativeJevUsage | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const usage = (value as Record<string, unknown>).usage
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return undefined
  const fields = usage as Record<string, unknown>
  const valid = (amount: unknown): amount is number => typeof amount === "number" && Number.isFinite(amount) && amount >= 0
  const inputTokens = valid(fields.inputTokens) ? fields.inputTokens : undefined
  const outputTokens = valid(fields.outputTokens) ? fields.outputTokens : undefined
  const costUsd = valid(fields.costUsd) ? fields.costUsd : undefined
  return inputTokens === undefined && outputTokens === undefined && costUsd === undefined ? undefined : { inputTokens, outputTokens, costUsd }
}

export class NativeJevUsageError extends Error {
  constructor(error: unknown, readonly usage: NativeJevUsage | undefined) {
    super(error instanceof Error ? error.message : String(error), { cause: error })
    this.name = "NativeJevUsageError"
  }
}

/** Recover billing only from the known native answer or audited HTTP schema, never error prose. */
export function legacyJevBilling(value: unknown): { attempted: boolean; usage?: NativeJevUsage; audited?: true } {
  const object = (item: unknown): item is Record<string, unknown> => item !== null && typeof item === "object" && !Array.isArray(item)
  if (!object(value)) return { attempted: false }
  const source = object(value.source) ? value.source : value
  const attempts = source.httpAttempts
  if (Array.isArray(attempts) && attempts.length && attempts.every((attempt): attempt is NativeJevHttpAttempt => {
    if (!object(attempt) || typeof attempt.url !== "string" || !/^https?:\/\//.test(attempt.url) || !object(attempt.headers) || !Object.values(attempt.headers).every((header) => typeof header === "string") || !object(attempt.requestBody) || typeof attempt.requestBody.model !== "string" || typeof attempt.requestBody.state !== "string" || !object(attempt.requestBody.questions)) return false
    return (attempt.status === undefined || Number.isInteger(attempt.status) && Number(attempt.status) >= 100 && Number(attempt.status) <= 599) && (attempt.error === undefined || typeof attempt.error === "string") && (attempt.status !== undefined || attempt.error !== undefined)
  })) return { attempted: true, usage: usageFromAttempts(attempts), audited: true }
  if (typeof value.role === "string" && object(value.model) && typeof value.model.providerID === "string" && typeof value.model.id === "string" && object(value.probabilities) && Object.hasOwn(value, "confidence")) return { attempted: true, usage: jevUsage(value) }
  return { attempted: false }
}
