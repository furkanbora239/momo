import { randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { z } from "zod"
import type { ModelPool } from "../shared/model-pool"

export const routingProfileID = z.enum(["auto", "chatgpt", "go"])
export type RoutingProfileID = z.infer<typeof routingProfileID>
export const routingModel = z.strictObject({ providerID: z.string().min(1), id: z.string().min(1) })
const models = z.array(routingModel)
export const routingProfile = z.strictObject({
  decision: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("jev"), fallback: routingModel.optional() }),
    z.strictObject({ kind: z.literal("chat"), model: routingModel, fallback: routingModel.optional() }),
    z.strictObject({ kind: z.literal("manual") }),
  ]),
  pool: z.strictObject({ mode: z.enum(["all", "allowlist", "paused"]), models }),
  advisors: models,
  research: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("inherit") }),
    z.strictObject({ kind: z.literal("off") }),
    z.strictObject({ kind: z.literal("chat"), model: routingModel }),
  ]),
})
export type RoutingProfile = z.infer<typeof routingProfile>
const stateSchema = z.strictObject({
  version: z.literal(1),
  revision: z.string(),
  active: routingProfileID,
  profiles: z.partialRecord(routingProfileID, routingProfile),
})
type RoutingProfileState = z.infer<typeof stateSchema>

export function effectiveRoutingPool(profile: RoutingProfile): ModelPool {
  return {
    version: 1, updatedAt: "",
    mode: profile.pool.mode,
    allowed: profile.pool.models.map(model => ({
      providerID: model.providerID, modelID: model.id,
    })),
  }
}

export function createRoutingProfileStore(path: string, legacy: () => RoutingProfile) {
  let cached: { source: string; state: RoutingProfileState } | undefined
  function read(): RoutingProfileState {
    try {
      const source = readFileSync(path, "utf8")
      if (cached?.source === source) return cached.state
      const state = stateSchema.parse(JSON.parse(source))
      cached = { source, state }
      return state
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, revision: "", active: "auto", profiles: {} }
      }
      throw new Error("Cannot read project routing profiles", { cause: error })
    }
  }
  function current(): RoutingProfile | undefined {
    const state = read()
    if (!state.revision) return
    const profile = state.profiles[state.active]
    if (!profile) throw new Error("Active routing profile is missing")
    return profile
  }
  function save(expected: string, active: RoutingProfileID, profile: RoutingProfile): RoutingProfileState {
    const state = read()
    if (state.revision !== expected) throw new Error("Routing settings changed. Reopen the panel to get the latest settings.")
    const next = stateSchema.parse({ ...state, revision: randomUUID(), active, profiles: { ...state.profiles, [active]: profile } })
    mkdirSync(dirname(path), { mode: 0o700, recursive: true })
    const temporary = `${path}.${next.revision}.tmp`
    try {
      const source = JSON.stringify(next, null, 2) + "\n"
      writeFileSync(temporary, source, { mode: 0o600, flag: "wx" })
      renameSync(temporary, path)
      cached = { source, state: next }
    } finally {
      rmSync(temporary, { force: true })
    }
    return next
  }
  return { read, current, save, legacy }
}
