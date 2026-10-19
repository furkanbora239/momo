import { describe, expect, test } from "bun:test"
import type { SessionInfo } from "@opencode/client"
import { createNativeCatalogResearchContext } from "./catalog-research-context"

type Session = Pick<SessionInfo, "id" | "parentID" | "agent" | "location" | "metadata">
function fixture() {
  const sessions = new Map<string, Session>()
  let creates = 0
  const active: Record<string, { type: "running" }> = {}
  const factory = () => createNativeCatalogResearchContext({
    directory: "/project", identity: "/home/native/project/catalog-discovery",
    sessions: {
      get: async ({ sessionID }) => { const row = sessions.get(sessionID); if (!row) throw Object.assign(new Error("session not found"), { status: 404 }); return row },
      create: async input => { creates++; const session = { ...input, location: { directory: input.location.directory, type: "local" as const } }; sessions.set(input.id, session); return session },
      active: async () => active,
    },
  })
  return { factory, sessions, active, creates: () => creates }
}
describe("catalog maintenance context", () => {
  test("concurrent discovery and restart reuse one non-generating native root", async () => {
    const f = fixture(), first = f.factory()
    expect(f.creates()).toBe(0)
    const [a, b] = await Promise.all([first.context(), first.context()])
    expect(a).toEqual(b)
    expect(await f.factory().context()).toEqual(a)
    expect(f.creates()).toBe(1)
    expect(await first.owns(a.rootSessionID)).toBe(true)
    expect(await first.owns("unrelated-root")).toBe(false)
  })
  test("a conflicting session identity cannot become a maintenance caller", async () => {
    const f = fixture(), helper = f.factory(), context = await helper.context()
    const current = f.sessions.get(context.rootSessionID)!
    f.sessions.set(current.id, { ...current, agent: "momo-worker" })
    await expect(helper.context()).rejects.toThrow("owned session identity")
  })
  test("foreground roots pause research, including a user-opened maintenance root", async () => {
    const f = fixture(), helper = f.factory(), context = await helper.context()
    f.active[context.rootSessionID] = { type: "running" }
    expect(await helper.isBusy()).toBe(true)
    delete f.active[context.rootSessionID]
    f.sessions.set("worker", { id: "worker", parentID: context.rootSessionID, agent: "momo-catalog-researcher", location: { type: "local", directory: "/project" } })
    f.active.worker = { type: "running" }
    expect(await helper.isBusy()).toBe(false)
  })
})
