import { join } from "node:path"
import { mkdir, writeFile, readdir, unlink, stat } from "node:fs/promises"
import { createHash } from "node:crypto"
import os from "node:os"

const MAX_CAPTURE_CHARS = 4_000_000
const PRUNE_MAX_AGE_MS = 60 * 60 * 1000 // 1 hour

export function resolveToolOutputCaptureDir(): string {
  return join(os.tmpdir(), "omo-tool-output")
}

function sanitizeId(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "_")
  if (cleaned.length > 0) return cleaned
  return createHash("sha1").update(raw).digest("hex").slice(0, 12)
}

export async function writeFullToolOutput(input: {
  sessionID: string
  callID: string
  content: string
  directory?: string
}): Promise<string | undefined> {
  try {
    const directory = input.directory ?? resolveToolOutputCaptureDir()
    await mkdir(directory, { recursive: true })

    const fileName = `${sanitizeId(input.sessionID)}__${sanitizeId(input.callID)}.txt`
    const filePath = join(directory, fileName)

    const toWrite = input.content.length > MAX_CAPTURE_CHARS
      ? input.content.slice(0, MAX_CAPTURE_CHARS)
      : input.content

    await writeFile(filePath, toWrite, "utf8")

    await pruneOldCaptures(directory).catch(() => {})

    return filePath
  } catch {
    return undefined
  }
}

async function pruneOldCaptures(directory: string): Promise<void> {
  const now = Date.now()
  const entries = await readdir(directory)
  await Promise.all(
    entries.map(async (entry) => {
      try {
        const full = join(directory, entry)
        const info = await stat(full)
        if (now - info.mtimeMs > PRUNE_MAX_AGE_MS) {
          await unlink(full)
        }
      } catch {
        // best-effort: ignore individual prune failures
      }
    })
  )
}

export function buildTruncationNotice(input: {
  maxOutputChars: number
  capturedPath?: string
  capturedChars?: number
  totalChars: number
}): string {
  if (input.capturedPath) {
    const savedNote = input.capturedChars !== undefined && input.capturedChars < input.totalChars
      ? `, first ${input.capturedChars} saved`
      : ""
    return `\n[output truncated at ${input.maxOutputChars} characters by momo tool-output cap. Full output (${input.totalChars} chars${savedNote}) saved to ${input.capturedPath}. Read that file with offset/limit to page through the rest.]`
  }
  return `\n[output truncated at ${input.maxOutputChars} characters by momo tool-output cap]`
}
