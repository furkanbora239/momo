import { expect, test } from "bun:test"
import { usageFromAttempts } from "./jev-http-usage"
import type { NativeJevHttpAttempt } from "./types"

function attempt(model: string, input = 100): NativeJevHttpAttempt {
  return { url: "https://opencode.ai/zen/v1/systemone", headers: {}, requestBody: { model }, status: 200,
    responseBody: { usage: { input_tokens: input, output_tokens: 99999 } } }
}

test("given free Jev retries, input stays visible and total charge stays zero", () => {
  expect(usageFromAttempts([attempt("jev-1.13-free"), attempt("jev-1.13-free", 200)]))
    .toEqual({ inputTokens: 300, outputTokens: 199998, costUsd: 0 })
})

test("given mixed paid and free audited requests, only paid input consumes budget", () => {
  expect(usageFromAttempts([attempt("jev-1.13-free", 1000), attempt("jev-1.13", 200)]))
    .toEqual({ inputTokens: 1200, outputTokens: 199998, costUsd: 200 * 0.042 / 1_000_000 })
})

test("given a custom model named free, its price is not assumed free", () => {
  expect(usageFromAttempts([attempt("custom-free")])?.costUsd).toBe(100 * 0.042 / 1_000_000)
})

test("given free Jev omits input usage, accounting preserves uncertainty", () => {
  expect(usageFromAttempts([{ ...attempt("jev-1.13-free"), responseBody: { usage: { output_tokens: 10 } } }]))
    .toEqual({ inputTokens: undefined, outputTokens: 10, costUsd: undefined })
})


test("given multiple same-price retries, billing matches the receipt total-input formula exactly", () => {
  const inputs = [123, 456, 789, 1023, 10021, 16003]
  const usage = usageFromAttempts(inputs.map(input => attempt("jev-1.13", input)))
  expect(usage?.costUsd).toBe(inputs.reduce((sum, value) => sum + value, 0) * 0.042 / 1_000_000)
})


test("given a custom endpoint reuses the free model identity, its estimated charge is not zero", () => {
  const custom = { ...attempt("jev-1.13-free"), url: "https://custom.invalid/systemone" }
  expect(usageFromAttempts([custom])?.costUsd).toBe(100 * 0.042 / 1_000_000)
})
