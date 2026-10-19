import { createHash } from "node:crypto"
import type { JobClassDefinitions, JobClassificationInput } from "./job-classification-types"

export function classificationObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}
export function classificationText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (classificationObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
  if (value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return JSON.stringify(value)
  throw new Error("classification facts must be finite JSON values")
}
export function jobModelKey(model: JobClassificationInput["model"]): string {
  if (!classificationText(model.providerID) || !classificationText(model.id)) throw new Error("classification model identity is required")
  return JSON.stringify([model.providerID, model.id])
}
export function jobClassificationFingerprint(definitions: JobClassDefinitions, input: JobClassificationInput): string {
  jobModelKey(input.model)
  if (!classificationText(definitions.version) || !classificationText(definitions.classifierVersion) || definitions.classes.length === 0 ||
      definitions.classes.some((entry) => !classificationText(entry.id) || !classificationText(entry.description)) ||
      new Set(definitions.classes.map((entry) => entry.id)).size !== definitions.classes.length) throw new Error("invalid job class definitions")
  if (input.evidence.some((entry) => !classificationText(entry.source) || !classificationObject(entry.facts))) throw new Error("classification evidence requires source-backed facts")
  return createHash("sha256").update(canonical({
    version: definitions.version, classifierVersion: definitions.classifierVersion,
    classes: [...definitions.classes].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    model: input.model,
    evidence: input.evidence.map(canonical).sort(),
  })).digest("hex")
}
