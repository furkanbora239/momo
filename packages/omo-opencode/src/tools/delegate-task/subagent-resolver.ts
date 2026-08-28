import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./executor-types"
import { log } from "../../shared/logger"
import { normalizeModelFormat } from "../../shared/model-format-normalizer"
import { resolveSubagentAgentMatch } from "./subagent-agent-match"
import { resolveSubagentModel } from "./subagent-model-resolution"
import { validateSubagentRequest } from "./subagent-request-preflight"
import { resolveAdvisorDelegationGate } from "./advisor-delegation-gate"
import type { ResolveSubagentExecutionOptions, ResolveSubagentExecutionResult } from "./subagent-resolution-types"

export type { ResolveSubagentExecutionOptions, ResolveSubagentExecutionResult }

export async function resolveSubagentExecution(
  args: DelegateTaskArgs,
  executorCtx: ExecutorContext,
  parentAgent: string | undefined,
  categoryExamples: string,
  options: ResolveSubagentExecutionOptions = {},
): Promise<ResolveSubagentExecutionResult> {
  const preflight = validateSubagentRequest(args, parentAgent, categoryExamples, options)
  if (preflight.kind === "invalid") {
    return preflight.result
  }

  let agentToUse = preflight.agentName

  // momo advisor gate: bound-on-demand. Reject unbound advisor delegation before
  // any session is spawned (zero surprise cost); a session-scoped binding
  // (advisor tool / /advisor) overrides both the config binding and the
  // registered placeholder model.
  const advisorGate = resolveAdvisorDelegationGate(agentToUse, executorCtx.agentOverrides, options.parentSessionID)
  if (advisorGate.kind === "unbound") {
    return { agentToUse: "", categoryModel: undefined, error: advisorGate.error }
  }

  try {
    const agentMatch = await resolveSubagentAgentMatch(agentToUse, executorCtx, options)
    if (agentMatch.kind === "error") {
      return agentMatch.result
    }

    agentToUse = agentMatch.agentToUse

    if (advisorGate.kind === "bound" && advisorGate.sessionModel) {
      const sessionModel = normalizeModelFormat(advisorGate.sessionModel)
      if (sessionModel) {
        return { agentToUse, categoryModel: sessionModel, fallbackChain: undefined }
      }
    }

    const { categoryModel, fallbackChain } = await resolveSubagentModel(agentToUse, agentMatch.matchedAgent, executorCtx)
    return { agentToUse, categoryModel, fallbackChain }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log("[delegate-task] Failed to resolve subagent execution", {
      requestedAgent: agentToUse,
      parentAgent,
      error: errorMessage,
    })

    return {
      agentToUse: "",
      categoryModel: undefined,
      error: `Failed to delegate to agent "${agentToUse}": ${errorMessage}`,
    }
  }
}
