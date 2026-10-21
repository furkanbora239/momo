import { describe, expect, test } from "bun:test"
import { z } from "zod"
import { consultInput, taskInput } from "./tool-operation-inputs"
import { describeNativeTool, nativeToolContractVersion } from "./tool-operation-help"

describe("native operation contract", () => {
  test("#given a coordinator #when requesting the index #then every validated operation is discoverable", () => {
    const result = describeNativeTool({ tool: "momo_task", role: "orchestrator" })
    expect(result.operations?.map(row => row.action)).toEqual(taskInput.options.map(schema => schema.shape.action.value))
    expect(result.contractVersion).toBe(nativeToolContractVersion)
    expect(JSON.stringify(result).length).toBeLessThan(4000)
    expect(result.inputSchema).toBeUndefined()
  })

  test("#given an operation #when requesting its schema #then help uses the runtime validator's schema", () => {
    const result = describeNativeTool({ tool: "momo_task", role: "orchestrator", operation: "select" })
    const schema = taskInput.options.find(option => option.shape.action.value === "select")!
    expect(result.inputSchema).toEqual(z.toJSONSchema(schema))
    expect(result.operations).toBeUndefined()
    expect(JSON.stringify(result).length).toBeLessThan(3000)
  })

  test("#given a worker or advisor #when discovering restricted tools #then role boundaries remain enforced", () => {
    expect(describeNativeTool({ tool: "momo_task", role: "worker" }).error?.code).toBe("tool_not_allowed")
    const worker = describeNativeTool({ tool: "momo_consult", role: "worker" })
    expect(worker.operations?.map(row => row.action)).toEqual(consultInput.options.map(schema => schema.shape.action.value))
    expect(worker.protocol?.questions.available).toBe(true)
    expect(describeNativeTool({ tool: "momo_consult", role: "advisor" }).error?.code).toBe("tool_not_allowed")
    expect(describeNativeTool({ tool: "momo_consult", role: "catalog-researcher" }).protocol?.questions.available).toBe(false)
  })

  test("#given an unknown operation #when discovering it #then a bounded index supports recovery", () => {
    const result = describeNativeTool({ tool: "momo_task", role: "orchestrator", operation: "invented" })
    expect(result.error?.code).toBe("unknown_operation")
    expect(result.inputSchema).toBeUndefined()
    expect(result.operations?.length).toBe(taskInput.options.length)
  })

  test("#given discovered examples #when parsed #then they match their exact operation validators", () => {
    for (const [tool, role, operation, input] of [
      ["momo_task", "orchestrator", "answer", taskInput],
      ["momo_task", "orchestrator", "wait", taskInput],
      ["momo_consult", "worker", "start", consultInput],
    ] as const) {
      const example = describeNativeTool({ tool, role, operation }).example
      expect(input.safeParse(example).success).toBe(true)
    }
  })

  test("#given existing and brief calls #when validating #then strict action schemas preserve valid contracts", () => {
    expect(taskInput.parse({ action: "create", prompt: "inspect" })).toEqual({ action: "create", prompt: "inspect" })
    expect(taskInput.parse({ action: "wait", taskID: "t", view: "brief", timeoutMs: 1000 })).toMatchObject({ view: "brief" })
    expect(consultInput.parse({ action: "start", prompt: "advise", view: "full" })).toMatchObject({ view: "full" })
    expect(taskInput.safeParse({ action: "create", prompt: "inspect", modelID: "unbound" }).success).toBe(false)
    expect(taskInput.safeParse({ action: "wait", taskID: "t", timeoutMs: 60001 }).success).toBe(false)
    expect(taskInput.safeParse({ action: "list", limit: 11 }).success).toBe(false)
    expect(consultInput.safeParse({ action: "resume", taskID: "t" }).success).toBe(false)
    expect(taskInput.parse({ action: "capabilities" })).toEqual({ action: "capabilities" })
    expect(consultInput.parse({ action: "help", operation: "start" })).toEqual({ action: "help", operation: "start" })
  })
})
