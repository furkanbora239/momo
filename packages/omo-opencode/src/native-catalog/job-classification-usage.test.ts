import { expect, test } from "bun:test"
import { captureJobClassificationUsage, isJobClassificationUsage } from "./job-classification-usage"

test("given audited free model usage, a zero-cost receipt remains valid after serialization", () => {
  const receipt = captureJobClassificationUsage("free", [{ input_tokens: 100, output_tokens: 2 }], "jev-1.13-free")
  expect(receipt).toMatchObject({ billedModel: "jev-1.13-free", status: "known", inputTokens: 100, costUsd: 0 })
  expect(isJobClassificationUsage(JSON.parse(JSON.stringify(receipt)))).toBe(true)
  expect(isJobClassificationUsage({ ...receipt, costUsd: 100 * 0.042 / 1_000_000 })).toBe(false)
})

test("given legacy paid receipts, compatibility does not allow zero-cost nonzero input", () => {
  const legacy = captureJobClassificationUsage("legacy", [{ input_tokens: 100 }])
  expect(isJobClassificationUsage(legacy)).toBe(true)
  expect(isJobClassificationUsage({ ...legacy, costUsd: 0 })).toBe(false)
  expect(isJobClassificationUsage({ ...legacy, billedModel: "custom-free", costUsd: 0 })).toBe(false)
  expect(isJobClassificationUsage({ ...legacy, billedModel: 0 })).toBe(false)
})

test("given missing audited usage for free Jev, classification cost stays unknown", () => {
  const receipt = captureJobClassificationUsage("missing", [undefined], "jev-1.13-free")
  expect(receipt.status).toBe("unknown")
  expect(receipt.costUsd).toBeUndefined()
  expect(isJobClassificationUsage(receipt)).toBe(true)
})


test("given a custom endpoint named free, persisted classification receipts retain the paid estimate", () => {
  const receipt = captureJobClassificationUsage("custom", [{ input_tokens: 100 }], "jev-1.13-free", "https://custom.invalid/systemone")
  expect(receipt.costUsd).toBe(100 * 0.042 / 1_000_000)
  expect(isJobClassificationUsage(JSON.parse(JSON.stringify(receipt)))).toBe(true)
  expect(isJobClassificationUsage({ ...receipt, costUsd: 0 })).toBe(false)
})
