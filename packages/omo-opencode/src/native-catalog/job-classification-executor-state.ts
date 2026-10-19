// MODIFIED: momo durable scheduling state; HTTP billing belongs to the injected audited executor.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"
import { classificationObject } from "./job-classification-identity"

export type ClassificationQueueEntry = {
  fingerprint: string
  state: "queued" | "inflight" | "failed" | "paused"
  revision: string
  reason?: string
  intentID?: string
}
export type ClassificationExecutorState = {
  version: 1
  entries: Record<string, ClassificationQueueEntry>
  batches: number
  completedProfiles: number
  staleProfiles: number
  lastReceiptID?: string
  lastError?: string
}
const counter = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
function malformed(): never { throw new Error("job classification executor state is malformed or unsupported") }
export function createClassificationExecutorState(filePath: string) {
  function load(): ClassificationExecutorState {
    if (!existsSync(filePath)) return { version: 1, entries: {}, batches: 0, completedProfiles: 0, staleProfiles: 0 }
    const raw: unknown = JSON.parse(readFileSync(filePath, "utf8"))
    if (!classificationObject(raw) || raw.version !== 1 || !classificationObject(raw.entries) || !counter(raw.batches) || !counter(raw.completedProfiles) || !counter(raw.staleProfiles) ||
      (raw.lastReceiptID !== undefined && typeof raw.lastReceiptID !== "string") || (raw.lastError !== undefined && typeof raw.lastError !== "string")) return malformed()
    const entries: Record<string, ClassificationQueueEntry> = {}
    for (const [key, entry] of Object.entries(raw.entries)) {
      if (!classificationObject(entry) || typeof entry.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(entry.fingerprint) || typeof entry.revision !== "string" ||
        !["queued", "inflight", "failed", "paused"].includes(String(entry.state)) || (entry.reason !== undefined && typeof entry.reason !== "string") || (entry.intentID !== undefined && typeof entry.intentID !== "string")) return malformed()
      entries[key] = { fingerprint: entry.fingerprint, state: entry.state as ClassificationQueueEntry["state"], revision: entry.revision, ...(entry.reason === undefined ? {} : { reason: entry.reason as string }), ...(entry.intentID === undefined ? {} : { intentID: entry.intentID as string }) }
    }
    return { version: 1, entries, batches: raw.batches, completedProfiles: raw.completedProfiles, staleProfiles: raw.staleProfiles, ...(raw.lastReceiptID === undefined ? {} : { lastReceiptID: raw.lastReceiptID }), ...(raw.lastError === undefined ? {} : { lastError: raw.lastError }) }
  }
  return {
    load,
    save(state: ClassificationExecutorState): void {
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
      const temporary = `${filePath}.${randomUUID()}.tmp`
      writeFileSync(temporary, JSON.stringify(state), { mode: 0o600 }); renameSync(temporary, filePath)
    },
  }
}
