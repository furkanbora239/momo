import { createReadStream } from "node:fs"
import { appendFile, chmod, mkdir, stat } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { createInterface } from "node:readline"
import type { NativeLedgerRecord, NativeRouterStore } from "./types"
import { parseNativeLedgerRecord } from "./ledger-validation"
import { acceptLedgerContent, decodeLedgerContent, encodeLedgerContent, type LedgerContentIndex } from "./ledger-content"

export function createJsonlNativeRouterStore(path: string, options: NativeJsonlRouterStoreOptions | ((lineNumber: number, reason: string) => void) = {}): NativeRouterStore {
  const config = typeof options === "function" ? { onMalformedRecord: options } : options
  const onMalformedRecord = config.onMalformedRecord ?? ((line, reason) => console.error(`[native-routing] corrupt JSONL record at line ${line}: ${reason}`))
  let queue = Promise.resolve()
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = queue.then(operation, operation)
    queue = next.then(() => undefined, () => undefined)
    return next
  }
  let content: LedgerContentIndex | undefined
  let latest: Map<string, NativeLedgerRecord> | undefined
  let loadedStamp: string | undefined
  async function stamp(): Promise<string> {
    try { const info = await stat(path, { bigint: true }); return `${info.ino}:${info.size}:${info.mtimeNs}` }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing"; throw error }
  }

  async function walk(filePath: string, visit: (line: string, number: number) => void): Promise<void> {
    const stream = createReadStream(filePath, { encoding: "utf8" })
    const lines = createInterface({ input: stream, crlfDelay: Infinity })
    let number = 0
    try { for await (const line of lines) { number += 1; if (line.length) visit(line, number) } }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
    finally { lines.close(); stream.destroy() }
  }

  function decode(line: string, number: number, nodes: LedgerContentIndex): NativeLedgerRecord | undefined {
    try {
      const value: unknown = JSON.parse(line)
      if (acceptLedgerContent(value, nodes)) return undefined
      let expanded = value
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const row = value as Record<string, unknown>
        if (row.version === 2 && row.type === "record" && typeof row.ref === "string") expanded = decodeLedgerContent(row.ref, nodes)
      }
      const record = parseNativeLedgerRecord(expanded)
      if (!record) throw new Error("unsupported or invalid ledger record")
      return record
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      onMalformedRecord(number, reason)
      throw new Error(`[native-routing] corrupt active ledger record at line ${number}: ${reason}`, { cause: error })
    }
  }

  const key = (record: NativeLedgerRecord): string => record.type === "decision" ? `decision:${record.decisionId}` : record.type === "jev_call" ? `jev_call:${record.callId}` : "breaker"
  async function ensureLoaded(): Promise<void> {
    const currentStamp = await stamp()
    if (content && latest && loadedStamp === currentStamp) return
    const nodes: LedgerContentIndex = new Map()
    const current = new Map<string, NativeLedgerRecord>()
    let pendingContent = false
    await walk(path, (line, number) => {
      const record = decode(line, number, nodes)
      pendingContent = !record
      if (record) current.set(key(record), record)
    })
    if (pendingContent) throw new Error("[native-routing] corrupt active ledger: incomplete content transaction")
    content = nodes
    latest = current
    loadedStamp = currentStamp
  }

  return {
    load: () => serialize(async () => { await ensureLoaded(); return structuredClone([...latest!.values()]) }),
    append: (record) => serialize(async () => {
      await ensureLoaded()
      let normalized: unknown
      try { normalized = JSON.parse(JSON.stringify(record)) as unknown }
      catch (error) { throw new Error("native routing ledger record is not JSON serializable", { cause: error }) }
      if (!parseNativeLedgerRecord(normalized)) throw new Error("invalid native routing ledger record")
      // Update the index only after the complete append succeeds.
      const staged = new Map(content!)
      const encoded = encodeLedgerContent(normalized, staged)
      const lines = [...encoded.lines, { version: 2, type: "record", ref: encoded.ref }]
      const payload = lines.map((line) => JSON.stringify(line)).join("\n") + "\n"
      const expectedSize = (loadedStamp === "missing" ? 0n : BigInt(loadedStamp!.split(":")[1]!)) + BigInt(Buffer.byteLength(payload))
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      try {
        await appendFile(path, payload, { encoding: "utf8", mode: 0o600 })
        await chmod(path, 0o600)
      } catch (error) { content = undefined; latest = undefined; throw error }
      content = staged
      loadedStamp = await stamp()
      latest!.set(key(record), normalized as NativeLedgerRecord)
      // Another store may append while this transaction is writing. Its records must be replayed.
      if (loadedStamp === "missing" || BigInt(loadedStamp.split(":")[1]!) !== expectedSize) { content = undefined; latest = undefined; loadedStamp = undefined }
    }),
    exportLines: () => serialize(async () => {
      const paths = [...new Set([...(config.legacyPaths ?? []), path].map((filePath) => resolve(filePath)))]
      const exported: string[] = []
      for (const filePath of paths) {
        const nodes: LedgerContentIndex = new Map()
        let pendingContent = false
        await walk(filePath, (line, number) => {
          if (filePath !== resolve(path)) { exported.push(line); return }
          const record = decode(line, number, nodes)
          pendingContent = !record
          if (record) exported.push(JSON.stringify(record))
        })
        if (pendingContent) throw new Error("[native-routing] corrupt active ledger: incomplete content transaction")
      }
      return exported
    }),
  }
}

export type NativeJsonlRouterStoreOptions = {
  readonly legacyPaths?: readonly string[]
  readonly onMalformedRecord?: (lineNumber: number, reason: string) => void
}
