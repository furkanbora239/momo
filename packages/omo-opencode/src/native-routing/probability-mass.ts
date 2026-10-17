/** Decimal probability rounding permits one percent mass drift, plus floating point summation error. */
export function hasValidProbabilityMass(values: readonly unknown[]): boolean {
  if (values.length === 0 || values.some((value) => typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) return false
  const total = values.reduce<number>((sum, value) => sum + Number(value), 0)
  return Math.abs(total - 1) <= 0.01 + Number.EPSILON * values.length
}
