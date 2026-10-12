import { appendFile, chmod, mkdir, readFile } from "node:fs/promises"
import { dirname } from "node:path"
import type { NativeLedgerRecord, NativeRouterStore } from "./types"
import { isVersionedNativeLedgerValue, parseNativeLedgerRecord } from "./ledger-validation"

export function createJsonlNativeRouterStore(
  path: string,
  onMalformedRecord: (lineNumber: number, reason: string) => void = (lineNumber, reason) => {
    console.error(`[native-routing] ignored malformed JSONL record at line ${lineNumber}: ${reason}`)
  },
): NativeRouterStore {
  let queue = Promise.resolve()
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation)
    queue = next.then(() => undefined, () => undefined)
    return next
  }

  async function rawLines(): Promise<string[]> {
    try {
      const contents = await readFile(path, "utf8")
      return contents.split(/\r?\n/).filter((line) => line.length > 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
  }

  return {
    load: () => serialize(async () => {
      const records: NativeLedgerRecord[] = []
      const lines = await rawLines()
      for (const [index, line] of lines.entries()) {
        try {
          const parsed: unknown = JSON.parse(line)
          const record = parseNativeLedgerRecord(parsed)
          if (record) records.push(record)
          else if (isVersionedNativeLedgerValue(parsed)) onMalformedRecord(index + 1, "unsupported or invalid version-1 record")
        } catch (error) {
          onMalformedRecord(index + 1, error instanceof Error ? "invalid JSON" : "JSON parser failed")
        }
      }
      return records
    }),
    append: (record) => serialize(async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      let line: string
      try {
        line = JSON.stringify(record)
      } catch (error) {
        throw new Error("native routing ledger record is not JSON serializable", { cause: error })
      }
      await appendFile(path, `${line}\n`, { encoding: "utf8", mode: 0o600 })
      await chmod(path, 0o600)
    }),
    exportLines: () => serialize(() => rawLines()),
  }
}
