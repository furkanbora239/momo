// MODIFIED: one persistent, non-generating root for idle catalog maintenance.
import { createHash } from "node:crypto"
import type { SessionInfo } from "@opencode/client"
import type { NativeResearchContext } from "../native-routing/types"
import type { NativeV2Client } from "./v2-service-client"

type ContextSession = Pick<SessionInfo, "id" | "agent" | "parentID" | "location" | "metadata">
function notFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const status = "status" in error ? error.status : "statusCode" in error ? error.statusCode : undefined
  return status === 404 || error instanceof Error && /session not found|not found.*session/i.test(error.message)
}
export function createNativeCatalogResearchContext(options: {
  directory: string
  identity: string
  sessions: Pick<NativeV2Client["session"], "active"> & {
    get(input: { sessionID: string }): Promise<ContextSession>
    create(input: { id: string; title: string; agent: string; location: { directory: string }; metadata: { momoCatalogMaintenance: true } }): Promise<ContextSession>
  }
}) {
  const rootID = `ses_${createHash("sha256").update(options.identity).digest("hex").slice(0, 26)}`
  let pending: Promise<NativeResearchContext> | undefined
  function verify(session: ContextSession): void {
    if (session.id !== rootID || session.parentID !== undefined || session.agent !== "momo-orchestrator" || session.location.directory !== options.directory || session.metadata?.momoCatalogMaintenance !== true) {
      throw new Error("Catalog maintenance root does not match its owned session identity")
    }
  }
  async function resolve(): Promise<NativeResearchContext> {
    let session: ContextSession
    try { session = await options.sessions.get({ sessionID: rootID }) }
    catch (error) {
      if (!notFound(error)) throw error
      try { session = await options.sessions.create({ id: rootID, title: "momo catalog maintenance", agent: "momo-orchestrator", location: { directory: options.directory }, metadata: { momoCatalogMaintenance: true } }) }
      catch (creationError) {
        // A second server may have won the same durable root identity.
        try { session = await options.sessions.get({ sessionID: rootID }) }
        catch (lookupError) { throw new Error("Catalog maintenance root creation failed", { cause: creationError ?? lookupError }) }
      }
    }
    verify(session)
    return { decisionId: `catalog-discovery:${rootID}`, rootSessionID: rootID, parentSessionID: rootID, parentRole: "orchestrator" }
  }
  return {
    async owns(sessionID: string): Promise<boolean> {
      if (sessionID !== rootID) return false
      try { verify(await options.sessions.get({ sessionID })); return true }
      catch (error) { if (notFound(error)) return false; throw error }
    },
    context() { pending ??= resolve().finally(() => { pending = undefined }); return pending },
    async isBusy(): Promise<boolean> {
      const active = await options.sessions.active()
      for (const sessionID of Object.keys(active)) {
        try {
          const session = await options.sessions.get({ sessionID })
          if (session.location.directory === options.directory && session.parentID === undefined) return true
        } catch (error) { if (!notFound(error)) throw error }
      }
      return false
    },
  }
}
