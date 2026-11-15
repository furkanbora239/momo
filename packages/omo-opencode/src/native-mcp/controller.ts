// MODIFIED: project-scoped MCP leases and draining without changing user policy.
import { resolveMcpPolicy, type McpMode, type McpPolicy } from "./policy"

interface ServerDefinition { readonly name: string; readonly upstreamDisabled?: boolean }
interface ControllerOptions {
  readonly settings: () => { modes?: McpPolicy; disabledMcps?: readonly string[] }
  readonly persist: (server: string, mode: McpMode) => Promise<void>
  readonly reload: () => Promise<void>
}

export function createNativeMcpController(options: ControllerOptions) {
  const definitions = new Map<string, ServerDefinition>()
  const leases = new Map<string, Set<string>>()
  const calls = new Map<string, string>()
  let queue = Promise.resolve()
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const result = queue.then(work)
    queue = result.then(() => undefined, () => undefined)
    return result
  }
  function policy(server: string) {
    const definition = definitions.get(server)
    if (!definition) throw new Error(`Unknown MCP server: ${server}`)
    return resolveMcpPolicy({ server, ...options.settings(), upstreamDisabled: definition.upstreamDisabled })
  }
  function activeCalls(server: string) { return [...calls.values()].filter(name => name === server).length }
  function requested(server: string) {
    const decision = policy(server)
    return decision.mode === "always" || decision.mode === "on-demand" && (leases.get(server)?.size ?? 0) > 0
  }
  const control = {
    observe(servers: readonly ServerDefinition[]) {
      definitions.clear()
      for (const server of servers) definitions.set(server.name, server)
    },
    shouldConnect(server: string) { return activeCalls(server) > 0 || requested(server) },
    canCall: requested,
    snapshot() {
      return [...definitions.keys()].sort().map(server => ({
        server, ...policy(server), requested: requested(server), draining: !requested(server) && activeCalls(server) > 0,
        activeCalls: activeCalls(server), leases: leases.get(server)?.size ?? 0,
      }))
    },
    setMode(server: string, mode: McpMode) {
      return serial(async () => {
        policy(server)
        await options.persist(server, mode)
        if (mode !== "on-demand") leases.delete(server)
        await options.reload()
      })
    },
    activate(server: string, sessionID: string) {
      return serial(async () => {
        const decision = policy(server)
        if (decision.mode === "off") throw new Error(`MCP ${server} is disabled: ${decision.blockedReason}`)
        if (decision.mode === "always") return
        const holders = leases.get(server) ?? new Set<string>()
        if (holders.has(sessionID)) return
        const previouslyConnected = requested(server)
        holders.add(sessionID)
        leases.set(server, holders)
        try { if (!previouslyConnected) await options.reload() }
        catch (error) { holders.delete(sessionID); throw error }
      })
    },
    release(server: string, sessionID: string) {
      return serial(async () => {
        policy(server)
        const connected = control.shouldConnect(server)
        leases.get(server)?.delete(sessionID)
        if (connected !== control.shouldConnect(server)) await options.reload()
      })
    },
    beginCall(server: string, callID: string) {
      if (!requested(server)) throw new Error(`MCP ${server} is not active for this project`)
      const existing = calls.get(callID)
      if (existing && existing !== server) throw new Error("MCP call identity changed")
      calls.set(callID, server)
    },
    endCall(callID: string) {
      return serial(async () => {
        const server = calls.get(callID)
        if (!server) return
        calls.delete(callID)
        if (activeCalls(server) === 0 && !requested(server)) await options.reload()
      })
    },
    releaseSession(sessionID: string) {
      return serial(async () => {
        let changed = false
        for (const [server, holders] of leases) {
          const connected = control.shouldConnect(server)
          holders.delete(sessionID)
          changed ||= connected !== control.shouldConnect(server)
        }
        if (changed) await options.reload()
      })
    },
  }
  return control
}

export type NativeMcpController = ReturnType<typeof createNativeMcpController>
