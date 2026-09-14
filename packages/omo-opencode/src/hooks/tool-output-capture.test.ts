import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, utimesSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  resolveToolOutputCaptureDir,
  writeFullToolOutput,
  buildTruncationNotice,
} from "./tool-output-capture"

let baseDir: string

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), "omo-capture-test-"))
})

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

describe("resolveToolOutputCaptureDir", () => {
  it("#then returns a path under the os temp dir", () => {
    const dir = resolveToolOutputCaptureDir()
    expect(dir).toContain("omo-tool-output")
    expect(dir.startsWith(tmpdir())).toBe(true)
  })
})

describe("writeFullToolOutput", () => {
  it("#given content and ids #when written #then returns the file path with exact content", async () => {
    const content = "worker report\nverify section\n".repeat(50)
    const path = await writeFullToolOutput({
      sessionID: "sess-1",
      callID: "call-2",
      content,
      directory: baseDir,
    })

    expect(path).toBeDefined()
    expect(path!.startsWith(baseDir)).toBe(true)
    expect(path!.endsWith(".txt")).toBe(true)
    const written = readFileSync(path!, "utf8")
    expect(written).toBe(content)
  })

  it("#given ids with slashes and spaces #then produces a safe filename that exists", async () => {
    const path = await writeFullToolOutput({
      sessionID: "sess/with space",
      callID: "call:weird*name",
      content: "data",
      directory: baseDir,
    })

    expect(path).toBeDefined()
    const info = statSync(path!)
    expect(info.isFile()).toBe(true)
    const fileName = path!.split("/").pop()!
    expect(fileName).not.toContain("/")
    expect(fileName).not.toContain(" ")
  })

  it("#given an unwritable parent #then returns undefined without throwing", async () => {
    const fileAsDir = join(baseDir, "blocker")
    writeFileSync(fileAsDir, "x")
    const path = await writeFullToolOutput({
      sessionID: "s",
      callID: "c",
      content: "data",
      directory: join(fileAsDir, "sub"),
    })

    expect(path).toBeUndefined()
  })

  it("#given content longer than the cap #then writes only the first MAX_CAPTURE_CHARS", async () => {
    const huge = "z".repeat(4_000_000 + 5000)
    const path = await writeFullToolOutput({
      sessionID: "s",
      callID: "c",
      content: huge,
      directory: baseDir,
    })

    expect(path).toBeDefined()
    const written = readFileSync(path!, "utf8")
    expect(written.length).toBe(4_000_000)
  })

  it("#given an old file in the directory #then pruning removes it while keeping fresh files", async () => {
    const oldPath = join(baseDir, "old.txt")
    const freshPath = join(baseDir, "fresh.txt")
    writeFileSync(oldPath, "old", () => {})
    writeFileSync(freshPath, "fresh", () => {})
    const oneHourAgo = Date.now() / 1000 - 3600 - 10
    utimesSync(oldPath, oneHourAgo, oneHourAgo)

    await writeFullToolOutput({
      sessionID: "s",
      callID: "c",
      content: "trigger",
      directory: baseDir,
    })

    let oldGone = false
    let freshPresent = false
    try {
      statSync(oldPath)
    } catch {
      oldGone = true
    }
    try {
      statSync(freshPath)
      freshPresent = true
    } catch {
      freshPresent = false
    }
    expect(oldGone).toBe(true)
    expect(freshPresent).toBe(true)
  })
})

describe("buildTruncationNotice", () => {
  it("#given a captured path #then includes the path and total char count", () => {
    const notice = buildTruncationNotice({
      maxOutputChars: 8000,
      capturedPath: "/tmp/omo-tool-output/sess__call.txt",
      totalChars: 9000,
    })

    expect(notice).toContain("/tmp/omo-tool-output/sess__call.txt")
    expect(notice).toContain("9000 chars")
    expect(notice).toContain("page through the rest")
  })

  it("#given captured chars less than total #then notes the saved prefix count", () => {
    const notice = buildTruncationNotice({
      maxOutputChars: 8000,
      capturedPath: "/tmp/x.txt",
      capturedChars: 4000,
      totalChars: 9000,
    })

    expect(notice).toContain("first 4000 saved")
  })

  it("#given no captured path #then falls back to the original dead-end marker", () => {
    const notice = buildTruncationNotice({
      maxOutputChars: 8000,
      totalChars: 9000,
    })

    expect(notice).toBe("\n[output truncated at 8000 characters by momo tool-output cap]")
  })
})
