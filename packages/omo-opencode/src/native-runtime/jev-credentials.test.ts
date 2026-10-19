import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { ManagerConfigSchema } from "../config/schema/decision-engine"
import { nativeJevApiKey } from "./jev-credentials"

test("free Jev defaults skip expired credentials without any credential resolution", async () => {
  let reads = 0
  const context = { provider: { list: async () => { reads++; throw new Error("expired auth must not be read") } } } as unknown as Plugin.Context
  const config = ManagerConfigSchema.parse({}).jev
  expect(config.model).toBe("jev-1.13-free")
  expect(config.provider_id).toBe("opencode")
  expect(await nativeJevApiKey(context, config)).toBeUndefined()
  expect(reads).toBe(0)
})

test("an explicitly configured paid model retains credential authentication defaults", () => {
  const config = ManagerConfigSchema.parse({ jev: { model: "jev-1.13" } }).jev
  expect(config.authentication).toBe("provider")
  expect(config.provider_id).toBe("opencode-go")
})

test("anonymous mode refuses paid models and custom endpoints", () => {
  expect(ManagerConfigSchema.safeParse({ jev: { model: "jev-1.13", authentication: "none" } }).success).toBe(false)
  expect(ManagerConfigSchema.safeParse({ jev: { model: "jev-1.13-free", base_url: "https://example.com/v1" } }).success).toBe(false)
})

test("partial existing paid bindings preserve provider authentication", () => {
  for (const partial of [{ base_url: "http://127.0.0.1:1234/v1" }, { provider_id: "opencode-go" }]) {
    const config = ManagerConfigSchema.parse({ jev: partial }).jev
    expect(config.model).toBe("jev-1.13")
    expect(config.provider_id).toBe("opencode-go")
    expect(config.authentication).toBe("provider")
  }
})
