import { jevInputPricePerMillion } from "@oh-my-opencode/decision-core"
import type { NativeJevAnswer, NativeJevHttpAttempt } from "./types"

export function usageFromAttempts(attempts: readonly NativeJevHttpAttempt[]): NativeJevAnswer["usage"] {
  let inputTokens = 0
  let outputTokens = 0
  const inputByPrice = new Map<number, number>()
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
    if (usage && valid(usage.input_tokens)) {
      inputTokens += usage.input_tokens; inputReported = true
      const request = attempt.requestBody
      const model = request && typeof request === "object" && !Array.isArray(request) && typeof (request as Record<string, unknown>).model === "string"
        ? (request as { model: string }).model : "jev-1.13"
      const price = jevInputPricePerMillion(model, attempt.url)
      inputByPrice.set(price, (inputByPrice.get(price) ?? 0) + usage.input_tokens)
    }
    else unknownCost = true
    if (usage && valid(usage.output_tokens)) { outputTokens += usage.output_tokens; outputReported = true }
  }
  const costUsd = [...inputByPrice].reduce((sum, [price, tokens]) => sum + tokens * price / 1_000_000, 0)
  return inputReported || outputReported || unknownCost ? { inputTokens: inputReported ? inputTokens : undefined, outputTokens: outputReported ? outputTokens : undefined, costUsd: unknownCost ? undefined : costUsd } : undefined
}

