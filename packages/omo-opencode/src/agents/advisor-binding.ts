// advisor-binding.ts — session-scoped advisor model binding.
//
// The advisor agent is unbound by default (zero surprise cost). It can be bound
// two ways, in precedence order:
//   1. A session-scoped binding (set by the /advisor command at runtime) — never
//      written to disk, lives only for the lifetime of the process/session.
//   2. A config binding (`agents.advisor.model`) — persistent, user-authored.
//
// `resolveAdvisorModel` implements that precedence; `parseAdvisorCommandArgs`
// parses the /advisor slash command surface.

export type AdvisorCommand =
  | { action: "report" }
  | { action: "unbind" }
  | { action: "bind"; model: string }

export interface AdvisorBindingSources {
  readonly configModel?: string
  readonly sessionModel?: string
}

/**
 * Session precedence over config. Returns undefined when neither is set, which
 * keeps the advisor unbound (skipped during agent registration).
 */
export function resolveAdvisorModel(sources: AdvisorBindingSources): string | undefined {
  if (sources.sessionModel && sources.sessionModel.length > 0) return sources.sessionModel
  if (sources.configModel && sources.configModel.length > 0) return sources.configModel
  return undefined
}

export function parseAdvisorCommandArgs(input: string | undefined): AdvisorCommand {
  const trimmed = input?.trim() ?? ""
  if (trimmed.length === 0) return { action: "report" }
  if (trimmed === "off" || trimmed === "unbind" || trimmed === "disable") {
    return { action: "unbind" }
  }
  return { action: "bind", model: trimmed }
}

// In-memory, process/session-scoped store. Keys are session ids; values are the
// bound model id (or null to represent an explicit /advisor off override).
const sessionBindings = new Map<string, string | null>()

export function setSessionAdvisorBinding(sessionId: string, model: string): void {
  sessionBindings.set(sessionId, model)
}

export function clearSessionAdvisorBinding(sessionId: string): void {
  sessionBindings.set(sessionId, null)
}

export function getSessionAdvisorBinding(sessionId: string): string | undefined {
  const value = sessionBindings.get(sessionId)
  return value === null || value === undefined ? undefined : value
}

export function hasSessionAdvisorBinding(sessionId: string): boolean {
  return sessionBindings.has(sessionId)
}

/** Observable session bindings in this process (empty unless set at runtime). */
export function listSessionAdvisorBindings(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [sessionId, value] of sessionBindings.entries()) {
    if (value !== null && value !== undefined) result[sessionId] = value
  }
  return result
}
