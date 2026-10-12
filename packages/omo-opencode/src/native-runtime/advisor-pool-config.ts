import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { applyEdits, modify, parse, printParseErrorCode } from "jsonc-parser"
import type { NativeModelRef } from "../native-routing/types"
import { loadNativeRuntimeConfig } from "./native-config"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function configPath(directory: string): string {
  return join(directory, ".omo", "omo.jsonc")
}

export function getAdvisorPool(directory: string): {
  read(): readonly NativeModelRef[]
  write(models: readonly NativeModelRef[]): void
} {
  const path = configPath(directory)
  return {
    read() {
      const models = loadNativeRuntimeConfig(directory).manager?.advisor_models ?? []
      return models.map((model) => ({ providerID: model.providerID, id: model.id }))
    },
    write(models) {
      const unique = [...new Map(models.map((model) => [`${model.providerID}/${model.id}`, model])).values()]
      const serialized = (() => {
        try {
          return readFileSync(path, "utf8")
        } catch (error) {
          if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") throw error
          return "{}\n"
        }
      })()
      const errors: { error: number; offset: number; length: number }[] = []
      const parsed: unknown = parse(serialized, errors)
      if (errors.length > 0) throw new Error(`Invalid JSONC at ${path}: ${errors.map((item) => `${printParseErrorCode(item.error)}@${item.offset}`).join(", ")}`)
      if (parsed !== undefined && !isRecord(parsed)) throw new Error(`Expected a JSONC object at ${path}`)
      const updated = applyEdits(serialized, modify(serialized, ["[opencode]", "manager", "advisor_models"], unique, { formattingOptions: { insertSpaces: true, tabSize: 2 } }))
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, updated, { mode: 0o600 })
    },
  }
}
