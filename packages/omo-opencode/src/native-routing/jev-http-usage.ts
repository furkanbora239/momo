import { JEV_INPUT_PRICE_PER_MILLION } from "@oh-my-opencode/decision-core"
import type { NativeJevAnswer, NativeJevHttpAttempt } from "./types"

export function usageFromAttempts(attempts: readonly NativeJevHttpAttempt[]): NativeJevAnswer["usage"] {
  let inputTokens = 0
  let outputTokens = 0
  let inputReported = false
  let outputReported = false
  let unknownCost = false
  for (const attempt of attempts) {
    if (!attempt.responseBody || typeof attempt.responseBody !== "object" || Array.isArray(attempt.responseBody)) {
      unknownCost = true
      continue
    }
    const raw = (attempt.responseBody as Record<string, unknown>).usage
    const usage = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined
    const valid = (amount: unknown): amount is number => typeof amount === "number" && Number.isFinite(amount) && amount >= 0
    if (usage && valid(usage.input_tokens)) { inputTokens += usage.input_tokens; inputReported = true }
    else unknownCost = true
    if (usage && valid(usage.output_tokens)) { outputTokens += usage.output_tokens; outputReported = true }
  }
  return inputReported || outputReported || unknownCost ? { inputTokens: inputReported ? inputTokens : undefined, outputTokens: outputReported ? outputTokens : undefined, costUsd: unknownCost ? undefined : inputTokens * JEV_INPUT_PRICE_PER_MILLION / 1_000_000 } : undefined
}

