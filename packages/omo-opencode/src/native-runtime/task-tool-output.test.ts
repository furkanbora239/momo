import { describe, expect, test } from "bun:test"
import type { NativeTask } from "../native-task"
import { compactTask, candidatePage, listTasksForCaller, resultPage, taskDetail, taskForCaller } from "./task-tool-output"
import { MemoryNativeTaskRepository } from "../native-task/testing"

function task(overrides: Partial<NativeTask> = {}): NativeTask {
  return { id: "task-1", rootTaskID: "task-1", rootSessionID: "root", parentSessionID: "parent", kind: "task", parentRole: "executor", state: "awaiting_selection", prompt: "edit marker", createdAt: 1, updatedAt: 2, attempts: 0, activeTools: [], childTaskIDs: [], processedEventIDs: [], lastActivityAt: 2, ...overrides }
}

describe("public native task output", () => {
  test("status stays compact with 424 historical candidates and large internal fields", () => {
    const record = task({ state: "succeeded", role: "executor", decisionId: "decision-1", candidates: Array.from({ length: 424 }, () => ({ role: "worker", model: { providerID: "test", id: "model" }, facts: { toolCall: true, nested: "x".repeat(1000) } })), result: "no edits performed".repeat(1000), progress: "producing", error: "old routing error", processedEventIDs: Array(128).fill("internal-event") })
    const output = compactTask(record)
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThan(8192)
    expect(output.id).toBe(record.id)
    expect(output.decisionId).toBe(record.decisionId)
    expect(output.execution.verification).toBe("unknown")
    expect(output.execution.status).toBe("succeeded")
    expect(output.rolePermissions?.canEdit).toBe(false)
    expect(output.rolePermissions?.canDelegate).toBe(true)
    expect(output.error).toBeUndefined()
    expect(output.activity.progress).toBeUndefined()
    expect(output.resultInfo?.truncated).toBe(true)
    expect("processedEventIDs" in output).toBe(false)
  })

  test("multibyte progress and result previews remain bounded in bytes", () => {
    const output=compactTask(task({state:"running",result:"界".repeat(20000),progress:"界".repeat(20000),activeTools:Array.from({length:20},()=>({id:"internal",name:"界".repeat(10000),startedAt:1}))}))
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThan(8192)
    expect(output.resultTruncated).toBe(true)
    expect(output.activity.activeToolCount).toBe(20)
    expect(output.activity.activeTools).toHaveLength(10)
  })

  test("candidates expose bounded model facts separately from runtime role permission", () => {
    const record = task({ decisionId: "decision-1", candidates: Array.from({ length: 424 }, (_, i) => ({ role: i % 2 ? "executor" : "worker", model: { providerID: "test", id: `model-${i}` }, facts: { toolCall: true }, knowledge: { summary: "x".repeat(10000) } })) })
    const page = candidatePage(record, { offset: 0, limit: 2, role: "executor" })
    expect(page.total).toBe(212)
    expect(page.nextOffset).toBe(2)
    expect(page.candidates).toHaveLength(2)
    expect(page.candidates[0]?.rolePermissions.canShell).toBe(false)
    expect(page.candidates[0]?.rolePermissions.canDelegate).toBe(true)
    expect(page.candidates[0]?.modelFacts.toolCall).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(8192)
  })

  test("result pages recover the exact actual result without inferring acceptance", () => {
    const record = task({ state: "succeeded", result: "abc".repeat(5000) })
    const first = resultPage(record, { offset: 0, limit: 1000 })
    expect(first.result).toBe(record.result?.slice(0, 1000))
    expect(first.nextOffset).toBe(1000)
    expect(resultPage(record, { offset: 15000, limit: 1000 }).result).toBe("")
  })

  test("detail preserves native question keys and bounded choice labels", () => {
    const output = taskDetail(task({state:"waiting_question",question:{id:"form-1",prompt:"Choose",form:{fields:[{key:"q0",title:"Proceed?",type:"select",options:[{value:"yes",label:"Yes"}]}]}}}))
    expect(output.question?.id).toBe("form-1")
    expect(output.questionFields?.[0]?.key).toBe("q0")
    expect(output.questionFields?.[0]?.title).toBe("Proceed?")
    expect(output.questionFields?.[0]?.options).toEqual([{value:"yes",label:"Yes"}])
  })

  test("list and recovery grant root and parent access but reject siblings and other roots", async () => {
    const repository = new MemoryNativeTaskRepository()
    for (const record of [task(), task({ id: "sibling", parentSessionID: "other-parent" }), task({ id: "maintenance", requiredRole: "catalog-researcher", sourceDecisionID: "source" }), task({ id: "other-root", rootSessionID: "other", parentSessionID: "elsewhere" }), task({ id: "consult", kind: "consultation" })]) await repository.save(record)
    expect((await listTasksForCaller(repository, "root", "task", {})).tasks.map((item) => item.id)).toEqual(["sibling", "task-1"])
    expect((await listTasksForCaller(repository, "parent", "task", {})).tasks.map((item) => item.id)).toEqual(["task-1"])
    expect((await listTasksForCaller(repository, "unknown", "task", {})).tasks).toEqual([])
    expect((await listTasksForCaller(repository, "root", "task", { includeMaintenance: true })).tasks.map((item) => item.id)).toContain("maintenance")
    expect((await taskForCaller(repository, "task-1", "parent", "task")).id).toBe("task-1")
    await expect(taskForCaller(repository, "sibling", "parent", "task")).rejects.toThrow("parent session and root session")
    await expect(taskForCaller(repository, "consult", "root", "task")).rejects.toThrow("No task")
  })
})
