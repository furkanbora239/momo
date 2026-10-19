import { existsSync, linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { randomUUID } from "node:crypto"
import { classificationObject, jobClassificationFingerprint, jobModelKey } from "./job-classification-identity"
import { isJobClassificationUsage } from "./job-classification-usage"
import type { JobClassDefinitions, JobClassificationInput, JobClassificationProfile, JobClassificationResult } from "./job-classification-types"

type StoredData = { version: 1; profiles: Record<string, JobClassificationProfile>; runs: JobClassificationResult["usage"][] }
function malformed(): never { throw new Error("native job classification store is malformed or unsupported") }
function isProfile(value: unknown): value is JobClassificationProfile {
  if (!classificationObject(value) || !classificationObject(value.model) || !classificationObject(value.definitions) ||
      !Array.isArray(value.evidence) || !Array.isArray(value.memberships) || value.provenance !== "jev-recommendation" ||
      typeof value.classifiedAt !== "string" || !Number.isFinite(Date.parse(value.classifiedAt))) return false
  try {
    const candidate = value as unknown as JobClassificationProfile
    if (candidate.fingerprint !== jobClassificationFingerprint(candidate.definitions, candidate)) return false
    const ids = candidate.definitions.classes.map((entry) => entry.id)
    return candidate.memberships.length === ids.length && new Set(candidate.memberships.map((entry) => entry.classId)).size === ids.length &&
      candidate.memberships.every((entry) => classificationObject(entry) && ids.includes(entry.classId) &&
        ["suitable", "unsuitable", "unknown"].includes(entry.suitability) && Number.isFinite(entry.confidence) && entry.confidence >= 0 && entry.confidence <= 1)
  } catch {
    return false
  }
}
/** Synchronous atomic snapshots. A single runtime maintenance owner must serialize classification runs. */
export function createJobClassificationStore(filePath: string, options: { readonly sharedDirectory?: string } = {}) {
  function sharedRead(fingerprint: string): JobClassificationProfile | undefined {
    if (!options.sharedDirectory) return undefined
    const path = join(options.sharedDirectory, fingerprint + ".json")
    let value: unknown
    try { value = JSON.parse(readFileSync(path, "utf8")) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error }
    if (!isProfile(value) || value.fingerprint !== fingerprint) return malformed()
    return value
  }
  function sharedSave(profile: JobClassificationProfile): void {
    if (!options.sharedDirectory) return
    if (sharedRead(profile.fingerprint)) return
    mkdirSync(options.sharedDirectory, { recursive: true, mode: 0o700 })
    const destination = join(options.sharedDirectory, profile.fingerprint + ".json")
    const temporary = destination + "." + randomUUID() + ".tmp"
    writeFileSync(temporary, JSON.stringify(profile), { mode: 0o600 })
    try {
      // Atomic no-replace publication retains the first valid recommendation.
      try { linkSync(temporary, destination) }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; sharedRead(profile.fingerprint) }
    } finally { unlinkSync(temporary) }
  }
  function load(): StoredData {
    if (!existsSync(filePath)) return { version: 1, profiles: {}, runs: [] }
    const data: unknown = JSON.parse(readFileSync(filePath, "utf8"))
    if (!classificationObject(data) || data.version !== 1 || !classificationObject(data.profiles) || !Array.isArray(data.runs) || !data.runs.every(isJobClassificationUsage)) return malformed()
    const profiles: Record<string, JobClassificationProfile> = {}
    for (const [key, value] of Object.entries(data.profiles)) {
      if (!isProfile(value) || jobModelKey(value.model) !== key) return malformed()
      profiles[key] = value
    }
    return { version: 1, profiles, runs: data.runs }
  }
  function lookup(data: StoredData, definitions: JobClassDefinitions, input: JobClassificationInput) {
    const fingerprint = jobClassificationFingerprint(definitions, input)
    const profile = data.profiles[jobModelKey(input.model)]
    return profile?.fingerprint === fingerprint ? profile : sharedRead(fingerprint)
  }
  return {
    read(definitions: JobClassDefinitions, input: JobClassificationInput): JobClassificationProfile | undefined {
      return lookup(load(), definitions, input)
    },
    /** Cold-start SDK metadata is valid input; no selected-model research dependency. Unknown is cached too. */
    pending(definitions: JobClassDefinitions, inputs: readonly JobClassificationInput[], limit: number): readonly JobClassificationInput[] {
      if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("classification queue limit must be nonnegative")
      const data = load()
      const seen = new Set<string>()
      return inputs.filter((input) => {
        const key = jobModelKey(input.model)
        if (seen.has(key)) return false
        seen.add(key)
        return !lookup(data, definitions, input)
      }).slice(0, limit)
    },
    save(result: JobClassificationResult): void {
      if (result.version !== 1 || result.profiles.length === 0 || !result.profiles.every(isProfile) || !isJobClassificationUsage(result.usage)) return malformed()
      const current = load()
      for (const profile of result.profiles) current.profiles[jobModelKey(profile.model)] = structuredClone(profile)
      current.runs.push(result.usage)
      mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 })
      const temporary = `${filePath}.${randomUUID()}.tmp`
      writeFileSync(temporary, JSON.stringify(current), { mode: 0o600 })
      renameSync(temporary, filePath)
      // Usage stays in this project snapshot and its authoritative paid-call ledger.
      for (const profile of result.profiles) sharedSave(profile)
    },
  }
}
