import { getAgentConfigKey } from "../../shared/agent-display-names"
import { getSessionAdvisorBinding, resolveAdvisorModel } from "../../agents/advisor-binding"
import type { AgentOverrides } from "../../config/schema"

/**
 * Delegation-time gate for the momo advisor agent.
 *
 * The advisor registers unconditionally at plugin startup (registration happens
 * once, before any session binding can exist), so "unbound = zero surprise cost"
 * is enforced HERE, at delegation time: task(subagent_type="advisor") is rejected
 * while no model is bound, and a session-scoped binding (set via the advisor
 * tool / /advisor command) overrides the registered placeholder model.
 */
export type AdvisorDelegationGate =
  | { readonly kind: "not-advisor" }
  | { readonly kind: "unbound"; readonly error: string }
  | { readonly kind: "bound"; readonly sessionModel?: string }

export function resolveAdvisorDelegationGate(
  agentName: string,
  agentOverrides: AgentOverrides | undefined,
  parentSessionID: string | undefined,
): AdvisorDelegationGate {
  if (getAgentConfigKey(agentName) !== "advisor") return { kind: "not-advisor" }

  const configModel = agentOverrides?.["advisor"]?.model
    ?? Object.entries(agentOverrides ?? {}).find(([key]) => key.toLowerCase() === "advisor")?.[1]?.model
  const sessionModel = parentSessionID ? getSessionAdvisorBinding(parentSessionID) : undefined
  const boundModel = resolveAdvisorModel({ configModel, sessionModel })

  if (!boundModel) {
    return {
      kind: "unbound",
      error:
        "The advisor agent is UNBOUND (zero surprise cost by default). Bind a model first: " +
        "run /advisor <model-id> for a session-scoped binding, or set agents.advisor.model in " +
        "~/.omo/omo.jsonc for a persistent one. Then retry the delegation.",
    }
  }

  return { kind: "bound", sessionModel }
}
