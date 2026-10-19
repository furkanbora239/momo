import { jevInputPricePerMillion } from "@oh-my-opencode/decision-core"
import { classificationObject, classificationText } from "./job-classification-identity"
import type { JobClassificationUsageReceipt } from "./job-classification-types"

const tokenCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0

/** Capture from every audited HTTP attempt before decoding answers. Caller must durably ledger this receipt first. */
export function captureJobClassificationUsage(receiptID: string, rawAttemptUsage: readonly unknown[], billedModel?: string, billedEndpoint?: string): JobClassificationUsageReceipt {
  if (!classificationText(receiptID) || rawAttemptUsage.length === 0) throw new Error("classification requires an audited HTTP attempt receipt")
  const input = rawAttemptUsage.map((usage) => classificationObject(usage) && tokenCount(usage.input_tokens) ? usage.input_tokens : undefined)
  const output = rawAttemptUsage.map((usage) => classificationObject(usage) && tokenCount(usage.output_tokens) ? usage.output_tokens : undefined)
  const inputTokens = input.every(tokenCount) ? input.reduce((sum, value) => sum + value, 0) : undefined
  const outputTokens = output.every(tokenCount) ? output.reduce((sum, value) => sum + value, 0) : undefined
  if ((inputTokens !== undefined && !tokenCount(inputTokens)) || (outputTokens !== undefined && !tokenCount(outputTokens))) throw new Error("classification usage exceeds safe token accounting range")
  if (billedModel !== undefined && !classificationText(billedModel)) throw new Error("classification billed model is invalid")
  if (billedEndpoint !== undefined && !classificationText(billedEndpoint)) throw new Error("classification billed endpoint is invalid")
  const common = { ...(billedEndpoint === undefined ? {} : { billedEndpoint }), ...(billedModel === undefined ? {} : { billedModel }), source: "audited-http" as const, receiptID, ...(outputTokens === undefined ? {} : { outputTokens }) }
  return inputTokens === undefined ? { ...common, status: "unknown" } : {
    ...common, status: "known", inputTokens, costUsd: inputTokens * jevInputPricePerMillion(billedModel ?? "jev-1.13", billedEndpoint) / 1_000_000,
  }
}

export function isJobClassificationUsage(value: unknown): value is JobClassificationUsageReceipt {
  if (!classificationObject(value) || value.source !== "audited-http" || !classificationText(value.receiptID) ||
      (value.billedModel !== undefined && !classificationText(value.billedModel)) ||
      (value.billedEndpoint !== undefined && !classificationText(value.billedEndpoint)) ||
      (value.outputTokens !== undefined && !tokenCount(value.outputTokens))) return false
  return value.status === "unknown" ? value.inputTokens === undefined && value.costUsd === undefined :
    value.status === "known" && tokenCount(value.inputTokens) && value.costUsd === value.inputTokens * jevInputPricePerMillion(typeof value.billedModel === "string" ? value.billedModel : "jev-1.13", typeof value.billedEndpoint === "string" ? value.billedEndpoint : undefined) / 1_000_000
}
