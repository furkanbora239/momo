import { expect, test } from "bun:test"
import { JEV_INPUT_PRICE_PER_MILLION, jevInputPricePerMillion } from "./jev-pricing"

test("given the explicit free Jev model, input price is zero", () => {
  expect(jevInputPricePerMillion("jev-1.13-free")).toBe(0)
})

test("given paid or custom identities, the existing paid estimate is retained", () => {
  for (const model of ["jev-1.13", "jev", "custom-free", "jev-1.13-free-copy", "provider/jev-1.13-free", ""]) {
    expect(jevInputPricePerMillion(model)).toBe(JEV_INPUT_PRICE_PER_MILLION)
  }
})


test("given a custom endpoint reuses the official free name, pricing remains a paid estimate", () => {
  for (const endpoint of ["https://custom.invalid/v1", "http://opencode.ai/zen/v1", "https://opencode.ai/zen/v1?key=x", "https://opencode.ai/zen/v1/systemone/extra"]) {
    expect(jevInputPricePerMillion("jev-1.13-free", endpoint)).toBe(JEV_INPUT_PRICE_PER_MILLION)
  }
  expect(jevInputPricePerMillion("jev-1.13-free", "https://opencode.ai/zen/v1/systemone")).toBe(0)
})
