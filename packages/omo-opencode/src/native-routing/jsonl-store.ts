import { appendFile, chmod, mkdir, readFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import type { NativeLedgerRecord, NativeRouterStore } from "./types"
import { isVersionedNativeLedgerValue, parseNativeLedgerRecord } from "./ledger-validation"

export function createJsonlNativeRouterStore(
  path: string,
  options: NativeJsonlRouterStoreOptions | ((lineNumber: number, reason: string) => void) = {},
): NativeRouterStore {
  const config = typeof options === "function" ? { onMalformedRecord: options } : options
  const onMalformedRecord = config.onMalformedRecord ?? ((lineNumber, reason) => {
    console.error(`[native-routing] ignored malformed JSONL record at line ${lineNumber}: ${reason}`)
  })
  let queue = Promise.resolve()
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation)
    queue = next.then(() => undefined, () => undefined)
    return next
  }

  async function rawLines(filePath = path): Promise<string[]> {
    try {
      const contents = await readFile(filePath, "utf8")
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
          else if (isVersionedNativeLedgerValue(parsed)) {
            const reason = "unsupported or invalid version-1 record"
            onMalformedRecord(index + 1, reason)
            throw new Error(`[native-routing] corrupt active ledger record at line ${index + 1}: ${reason}`)
          } else {
            const reason = "unexpected legacy or unversioned record in active ledger"
            onMalformedRecord(index + 1, reason)
            throw new Error(`[native-routing] corrupt active ledger record at line ${index + 1}: ${reason}`)
          }
        } catch (error) {
          if (error instanceof Error && error.message.startsWith("[native-routing] corrupt active ledger")) throw error
          const reason = "invalid JSON"
          onMalformedRecord(index + 1, reason)
          throw new Error(`[native-routing] corrupt active ledger record at line ${index + 1}: ${reason}`, { cause: error })
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
    exportLines: () => serialize(async () => {
      const paths = [...new Set([...(config.legacyPaths ?? []), path].map((filePath) => resolve(filePath)))]
      const exported: string[] = []
      for (const filePath of paths) exported.push(...await rawLines(filePath))
      return exported
    }),
  }
}

export type NativeJsonlRouterStoreOptions = {
  readonly legacyPaths?: readonly string[]
  readonly onMalformedRecord?: (lineNumber: number, reason: string) => void
}
