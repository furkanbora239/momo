import { classificationObject, classificationText } from "./job-classification-identity"
import type { JobClassificationUsageReceipt } from "./job-classification-types"

const INPUT_PRICE_PER_MILLION = 0.042
const tokenCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0

/** Capture from every audited HTTP attempt before decoding answers. Caller must durably ledger this receipt first. */
export function captureJobClassificationUsage(receiptID: string, rawAttemptUsage: readonly unknown[]): JobClassificationUsageReceipt {
  if (!classificationText(receiptID) || rawAttemptUsage.length === 0) throw new Error("classification requires an audited HTTP attempt receipt")
  const input = rawAttemptUsage.map((usage) => classificationObject(usage) && tokenCount(usage.input_tokens) ? usage.input_tokens : undefined)
  const output = rawAttemptUsage.map((usage) => classificationObject(usage) && tokenCount(usage.output_tokens) ? usage.output_tokens : undefined)
  const inputTokens = input.every(tokenCount) ? input.reduce((sum, value) => sum + value, 0) : undefined
  const outputTokens = output.every(tokenCount) ? output.reduce((sum, value) => sum + value, 0) : undefined
  if ((inputTokens !== undefined && !tokenCount(inputTokens)) || (outputTokens !== undefined && !tokenCount(outputTokens))) throw new Error("classification usage exceeds safe token accounting range")
  const common = { source: "audited-http" as const, receiptID, ...(outputTokens === undefined ? {} : { outputTokens }) }
  return inputTokens === undefined ? { ...common, status: "unknown" } : {
    ...common, status: "known", inputTokens, costUsd: inputTokens * INPUT_PRICE_PER_MILLION / 1_000_000,
  }
}

export function isJobClassificationUsage(value: unknown): value is JobClassificationUsageReceipt {
  if (!classificationObject(value) || value.source !== "audited-http" || !classificationText(value.receiptID) ||
      (value.outputTokens !== undefined && !tokenCount(value.outputTokens))) return false
  return value.status === "unknown" ? value.inputTokens === undefined && value.costUsd === undefined :
    value.status === "known" && tokenCount(value.inputTokens) && value.costUsd === value.inputTokens * INPUT_PRICE_PER_MILLION / 1_000_000
}
