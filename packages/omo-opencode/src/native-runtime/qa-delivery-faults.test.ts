import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { installNativeQaDeliveryFaults } from "../../../../script/qa/momo-native-delivery-faults"

let originalFetch = globalThis.fetch
const directories: string[] = []
beforeEach(() => { originalFetch = globalThis.fetch })
afterEach(() => {
  globalThis.fetch = originalFetch
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe("native QA delivery fault continuity", () => {
  for (const kind of ["form", "result"] as const) {
    it(`preserves the injected ${kind} fault across a fixture restart`, async () => {
      const directory = mkdtempSync(join(tmpdir(), "momo-qa-fault-state-"))
      directories.push(directory)
      const logPath = join(directory, "faults.jsonl")
      globalThis.fetch = Object.assign(async () => new Response(JSON.stringify({ data: { parent: {} } }), { status: 200 }), originalFetch)
      const metadata = kind === "form" ? { momoNativeFormKind: "question" } : { momoNativeDelivery: true }
      const request = () => fetch(`http://fixture.invalid/api/session/parent/${kind === "form" ? "form" : "synthetic"}`, {
        method: "POST", body: JSON.stringify({ id: "same-id", metadata }),
      })
      const dispose = installNativeQaDeliveryFaults(logPath)
      expect((await request()).status).toBe(503)
      dispose()
      const disposeRestarted = installNativeQaDeliveryFaults(logPath)
      expect((await request()).status).toBe(200)
      disposeRestarted()
      const records = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { id: string; attempt: number; injected: boolean })
      expect(records.map((row) => row.injected)).toEqual([true, false])
      expect(records.map((row) => row.id)).toEqual(["same-id", "same-id"])
      expect(records.map((row) => row.attempt)).toEqual([1, 2])
    })
  }
})
