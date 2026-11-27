// MODIFIED: expose effective native capabilities without changing caller authority.
import type { NativeModelRef } from "../native-routing/types"
import { nativeParentQuestionAllowed, nativeToolAllowed, type NativeAgentID } from "./role-policy"

export async function readNativeToolCapabilities(options: {
  agent: NativeAgentID
  managed: boolean
  advisors: readonly NativeModelRef[]
  available: readonly (NativeModelRef & { available: boolean; toolCall?: boolean })[]
  callerModel?: NativeModelRef
  isAllowed(model: NativeModelRef): Promise<boolean> | boolean
}) {
  const canConsult = nativeToolAllowed(options.agent, "momo_consult")
  const eligible: NativeModelRef[] = []
  const seen = new Set<string>()
  let excludedCallerModel = false
  for (const ref of options.advisors) {
    const key = JSON.stringify([ref.providerID, ref.id])
    if (seen.has(key)) continue
    seen.add(key)
    const available = options.available.some(model => model.available && model.toolCall !== false && model.providerID === ref.providerID && model.id === ref.id)
    if (!available || !await options.isAllowed(ref)) continue
    if (options.callerModel?.providerID === ref.providerID && options.callerModel.id === ref.id) {
      excludedCallerModel = true
      continue
    }
    eligible.push({ providerID: ref.providerID, id: ref.id })
  }
  const questions = options.managed ? nativeParentQuestionAllowed(options.agent) : options.agent === "momo-orchestrator"
  return {
    role: options.agent.slice("momo-".length),
    delegation: { allowed: nativeToolAllowed(options.agent, "momo_task") },
    consultation: { allowed: canConsult, enabled: canConsult && eligible.length > 0,
      reason: !canConsult ? "role_denied" : seen.size === 0 ? "advisor_pool_empty" : eligible.length > 0 ? undefined : excludedCallerModel ? "no_distinct_advisor" : "no_eligible_advisor",
      configuredCount: seen.size, eligibleCount: eligible.length, models: canConsult ? eligible.slice(0, 10) : [], truncated: canConsult && eligible.length > 10,
    },
    questions: { supported: questions, tool: questions ? options.managed ? "momo_ask_parent" : "question" : undefined,
      destination: questions ? options.managed ? "parent" : "user" : undefined,
      replyTool: questions ? "momo_task answer" : undefined },
    monitoring: { maxWaitMs: 60000, pageLimit: 10, notifications: "durable", steering: false },
  }
}
