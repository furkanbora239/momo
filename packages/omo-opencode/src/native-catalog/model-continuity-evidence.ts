// MODIFIED: normalize OpenCode's native provider rejection envelopes.
import { parseNativeQuotaFailure } from "./model-quota-evidence"

export type NativeModelRejection =
  | { kind: "rate_limit"; scope: "model"; retryAfterMs: number; explicitRetryAfter?: true }
  | { kind: "payment_required"; scope: "model" | "provider"; retryAfterMs: number }

const accountBalanceCodes = new Set(["insufficient_balance", "account_balance_exhausted"])

export function parseNativeModelRejection(value: unknown): NativeModelRejection | undefined {
  const error = asRecord(value)
  if (typeof error?.type !== "string" || !error.type.startsWith("provider.")) return undefined
  if (error.status === 429) {
    const wait = error.retryAfterMs
    if (typeof wait === "number" && Number.isFinite(wait) && wait > 0) {
      return { kind: "rate_limit", scope: "model", retryAfterMs: Math.min(wait, 86_400_000), explicitRetryAfter: true }
    }
    return { kind: "rate_limit", scope: "model", retryAfterMs: 60_000 }
  }
  if (error.status !== 402) return undefined
  const body = asRecord(error.response)?.body
  let details = asRecord(body)
  if (typeof body === "string" && body.length <= 16_384) {
    try { details = asRecord(JSON.parse(body)) }
    catch (error) { if (!(error instanceof SyntaxError)) throw error }
  }
  const code = asRecord(details?.error)?.code
  return { kind: "payment_required", scope: typeof code === "string" && accountBalanceCodes.has(code) ? "provider" : "model", retryAfterMs: 300_000 }
}

export function nativeModelRejectionSummary(value: unknown): string | undefined {
  const error = asRecord(value)
  if (!error || !parseNativeModelRejection(error)) return undefined
  return JSON.stringify(parseNativeQuotaFailure(error) ?? { type: error.type, status: error.status })
}

/** The persisted string is only a hint. Session inspection proves the rejection. */
export function isNativeModelRejectionHint(message: string): boolean {
  try {
    const error = asRecord(JSON.parse(message))
    return typeof error?.type === "string" && error.type.startsWith("provider.") && (error.status === 402 || error.status === 429)
  } catch (error) {
    return false
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}
