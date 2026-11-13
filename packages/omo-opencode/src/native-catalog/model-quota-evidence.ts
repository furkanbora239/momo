// MODIFIED: momo model-scoped evidence from native provider failures.
export type NativeQuotaFailure = { type: "provider.free-limit"; status: 429; retryAfterMs: number }

/** Unknown input supports newer native error variants without trusting error prose. */
export function parseNativeQuotaFailure(value: unknown): NativeQuotaFailure | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined
  const error = value as Record<string, unknown>
  if (error.type !== "provider.free-limit" || error.status !== 429) return undefined
  if (typeof error.retryAfterMs !== "number" || !Number.isFinite(error.retryAfterMs) || error.retryAfterMs <= 0) return undefined
  // A bad upstream reset must not quarantine a model indefinitely.
  return { type: "provider.free-limit", status: 429, retryAfterMs: Math.min(error.retryAfterMs, 86_400_000) }
}

/** Event serialization is only an inspection hint; native context remains authority. */
export function isNativeQuotaFailureHint(message: string): boolean {
  try { return parseNativeQuotaFailure(JSON.parse(message)) !== undefined }
  catch (error) { return false }
}
