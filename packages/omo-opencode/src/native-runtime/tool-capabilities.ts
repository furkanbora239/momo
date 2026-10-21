// MODIFIED: expose effective native capabilities without changing caller authority.
import type { NativeModelRef } from "../native-routing/types"
import { nativeToolAllowed, type NativeAgentID } from "./role-policy"

export async function readNativeToolCapabilities(options: {
  agent: NativeAgentID
  advisors: readonly NativeModelRef[]
  available: readonly (NativeModelRef & { available: boolean; toolCall?: boolean })[]
  isAllowed(model: NativeModelRef): Promise<boolean> | boolean
}) {
  const canConsult = nativeToolAllowed(options.agent, "momo_consult")
  const eligible: NativeModelRef[] = []
  const seen = new Set<string>()
  for (const ref of options.advisors) {
    const key = JSON.stringify([ref.providerID, ref.id])
    if (seen.has(key)) continue
    seen.add(key)
    if (options.available.some(model => model.available && model.toolCall !== false && model.providerID === ref.providerID && model.id === ref.id) && await options.isAllowed(ref)) eligible.push({ providerID: ref.providerID, id: ref.id })
  }
  const questions = options.agent !== "momo-advisor" && options.agent !== "momo-catalog-researcher"
  return {
    role: options.agent.slice("momo-".length),
    delegation: { allowed: nativeToolAllowed(options.agent, "momo_task") },
    consultation: { allowed: canConsult, enabled: canConsult && eligible.length > 0,
      reason: !canConsult ? "role_denied" : seen.size === 0 ? "advisor_pool_empty" : eligible.length === 0 ? "no_eligible_advisor" : undefined,
      configuredCount: seen.size, eligibleCount: eligible.length, models: canConsult ? eligible.slice(0, 10) : [], truncated: canConsult && eligible.length > 10,
    },
    questions: { supported: questions, tool: questions ? "question" : undefined,
      destination: questions ? options.agent === "momo-orchestrator" ? "user" : "parent_then_root" : undefined,
      replyTool: questions ? "momo_task answer" : undefined },
    monitoring: { maxWaitMs: 60000, pageLimit: 10, notifications: "durable", steering: false },
  }
}
