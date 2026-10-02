;
import type { PluginContext } from "../../plugin/types"
import { ALLOWED_AGENTS } from "./constants";

export function clearCallableAgentsCache(): void {
  // Kept for existing test setup and external callers; the resolver is now static.
}

/**
 * Resolves the set of callable agent names for call_omo_agent.
 *
 * This tool is deliberately narrower than delegate-task: it may only launch
 * the research lookup agents used by worker-style agents while they continue
 * local work. Dynamic agents and other built-ins must go through task().
 */
export async function resolveCallableAgents(
  _client?: PluginContext["client"],
  _sessionId?: string,
): Promise<string[]> {
  return [...ALLOWED_AGENTS];
}
