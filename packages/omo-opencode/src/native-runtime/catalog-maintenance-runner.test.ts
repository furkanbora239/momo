import { expect, test } from "bun:test"
import { createCatalogMaintenanceRunner } from "./catalog-maintenance-runner"

test("shutdown drains slow discovery without launching maintenance and prevents future runs", async () => {
  let release: (() => void) | undefined, stopped = false, pumps = 0, discoveries = 0
  const waiting = new Promise<void>(resolve => { release = resolve })
  const runner = createCatalogMaintenanceRunner({ discover: async () => { discoveries++; await waiting }, pump: async () => { pumps++ } })
  const running = runner.run()
  expect(runner.run()).toBe(running)
  const stopping = runner.stop().then(() => { stopped = true })
  await Promise.resolve()
  expect(runner.stopping()).toBe(true)
  expect(stopped).toBe(false)
  release!()
  await stopping
  await running
  await runner.run()
  expect(discoveries).toBe(1)
  expect(pumps).toBe(0)
})


test("discovery failure remains visible to its caller while shutdown can finish cleanup", async () => {
  const runner = createCatalogMaintenanceRunner({ discover: async () => { throw new Error("provider unavailable") }, pump: async () => { throw new Error("must not run") } })
  await expect(runner.run()).rejects.toThrow("provider unavailable")
  await runner.stop()
  expect(runner.stopping()).toBe(true)
})
