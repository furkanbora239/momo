import { appendFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import type { LogEntry } from "./types"
import { log } from "../../shared/logger"

function getLogDir(): string {
  return join(homedir(), ".omo", "local-translator-logs")
}

function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10)
  return join(getLogDir(), `${date}.jsonl`)
}

export function logTranslation(entry: LogEntry): void {
  try {
    mkdirSync(getLogDir(), { recursive: true })
    appendFileSync(getLogFilePath(), JSON.stringify(entry) + "\n", "utf-8")
  } catch (error) {
    log("[local-translator] Failed to write translation log", { error })
  }
}
