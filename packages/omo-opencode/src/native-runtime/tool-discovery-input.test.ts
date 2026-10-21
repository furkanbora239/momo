import { expect, test } from "bun:test"
import { z } from "zod"
import { taskInput, consultInput } from "./tool-operation-inputs"
import { taskDiscoveryInput, consultDiscoveryInput } from "./tool-discovery-input"

test("discovery advertises current operations without embedding every argument schema", () => {
  expect(taskDiscoveryInput.shape.action.options).toEqual(taskInput.options.map(schema => schema.shape.action.value))
  expect(consultDiscoveryInput.shape.action.options).toEqual(consultInput.options.map(schema => schema.shape.action.value))
  expect(JSON.stringify(z.toJSONSchema(taskDiscoveryInput)).length).toBeLessThan(JSON.stringify(z.toJSONSchema(taskInput)).length / 3)
  expect(taskDiscoveryInput.safeParse({ action: "invented" }).success).toBe(false)
})

test("small envelope preserves arguments but strict execution validation rejects forged fields", () => {
  const valid = taskDiscoveryInput.parse({ action: "create", prompt: "Work", view: "brief" })
  expect(taskInput.parse(valid)).toMatchObject({ prompt: "Work", view: "brief" })
  const forged = taskDiscoveryInput.parse({ action: "create", prompt: "Work", modelID: "unoffered", rootSessionID: "forged" })
  expect(taskInput.safeParse(forged).success).toBe(false)
  expect(consultInput.safeParse(consultDiscoveryInput.parse({ action: "start" })).success).toBe(false)
})
