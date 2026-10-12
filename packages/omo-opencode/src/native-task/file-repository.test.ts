import { afterEach, describe, expect, it } from "bun:test"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { createFileNativeTaskRepository } from "./file-repository"
import type { NativeTask } from "./types"

const directories: string[] = []
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function setupPath(): Promise<string> {
  const directory = await mkdtemp("/private/tmp/native-task-store-")
  directories.push(directory)
  return join(directory, "tasks.json")
}

function task(): NativeTask {
  return {
    id: "task-a", rootTaskID: "task-a", rootSessionID: "session-root", parentSessionID: "session-root",
    kind: "task", parentRole: "orchestrator", role: "worker", model: { providerID: "p", id: "m" },
    state: "running", prompt: "build", createdAt: 1, updatedAt: 1, attempts: 1,
    activeTools: [], childTaskIDs: [], processedEventIDs: [], lastActivityAt: 1,
  }
}

describe("file native task repository", () => {
  it("persists complete task records across repository instances", async () => {
    const filePath = await setupPath()
    const first = createFileNativeTaskRepository(filePath)
    await first.save(task())
    const second = createFileNativeTaskRepository(filePath)

    expect(await second.get("task-a")).toEqual(task())
    expect(JSON.parse(await readFile(filePath, "utf8")).version).toBe(1)
  })

  it("fails closed on invalid existing state instead of replacing it with an empty task list", async () => {
    const filePath = await setupPath()
    await writeFile(filePath, "{ broken")
    const repository = createFileNativeTaskRepository(filePath)

    await expect(repository.list()).rejects.toThrow("contains invalid JSON")
    expect(await readFile(filePath, "utf8")).toBe("{ broken")
  })

  it("serializes concurrent snapshots without losing task records", async () => {
    const filePath = await setupPath()
    const repository = createFileNativeTaskRepository(filePath)
    const records = [task(), { ...task(), id: "task-b", rootTaskID: "task-b", prompt: "review" }]

    await Promise.all(records.map((record) => repository.save(record)))

    expect((await repository.list()).map((record) => record.id).sort()).toEqual(["task-a", "task-b"])
  })
})
