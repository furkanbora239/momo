import type { Plugin } from "@opencode/plugin"
import { filterNativeContextTools, nativeActionEffect, ownedAgentID } from "./role-policy"

export async function registerNativePermissions(ctx: Plugin.Context, activeOwnedIDs: ReadonlySet<string>): Promise<() => Promise<void>> {
  const permissionRegistration = await ctx.permission.hook("evaluate", async (event) => {
    const session = event.agent === undefined ? await ctx.session.get({ sessionID: event.sessionID }) : undefined
    const id = event.agent ?? session?.agent
    const role = id !== undefined && activeOwnedIDs.has(id) ? ownedAgentID(id) : undefined
    if (role === undefined) return
    const effect = nativeActionEffect(role, event.action)
    if (effect !== undefined) event.effect = effect
  })
  const contextRegistration = await ctx.session.hook("context", (event) => {
    filterNativeContextTools(event.agent, event.tools, activeOwnedIDs)
  })
  const executionRegistration = await ctx.tool.hook("execute.before", (event) => {
    const role = activeOwnedIDs.has(event.agent) ? ownedAgentID(event.agent) : undefined
    if (role === undefined || nativeActionEffect(role, event.tool) !== "deny") return
    throw new Error(`Native ${role} role cannot execute ${event.tool}`)
  })
  return async () => {
    await executionRegistration.dispose()
    await contextRegistration.dispose()
    await permissionRegistration.dispose()
  }
}
