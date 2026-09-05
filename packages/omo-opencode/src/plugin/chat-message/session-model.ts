import type { OhMyOpenCodeConfig } from "../../config"
import { subagentSessions, getMainSessionID } from "../../features/claude-code-session-state"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { getSessionModel, setSessionModel } from "../../shared/session-model-state"
import type { ChatMessageHandlerOutput, ChatMessageInput, SessionModelOverride } from "./types"

function hasExplicitAgentModelOverride(
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig,
): boolean {
  const configuredAgents = pluginConfig.agents
  const normalizedAgent = typeof agent === "string" ? getAgentConfigKey(agent) : undefined
  if (!normalizedAgent || !configuredAgents) {
    return false
  }

  const candidateKeys = [normalizedAgent]
  if (normalizedAgent === "planner") candidateKeys.push("prometheus")
  if (normalizedAgent === "prometheus") candidateKeys.push("planner")
  if (normalizedAgent === "worker") candidateKeys.push("sisyphus-junior")
  if (normalizedAgent === "sisyphus-junior") candidateKeys.push("worker")
  if (normalizedAgent === "orchestrator") candidateKeys.push("sisyphus")
  if (normalizedAgent === "sisyphus") candidateKeys.push("orchestrator")

  for (const key of candidateKeys) {
    if (key in configuredAgents) {
      const configuredAgent = configuredAgents[key as keyof typeof configuredAgents]
      const configuredModel = configuredAgent?.model
      if (typeof configuredModel === "string" && configuredModel.trim().length > 0) {
        return true
      }
    }
  }

  return false
}

export function getStoredMainSessionModel(
  input: ChatMessageInput,
  pluginConfig: OhMyOpenCodeConfig,
  isFirstMessage: boolean,
): SessionModelOverride | undefined {
  if (isFirstMessage) {
    return undefined
  }

  if (subagentSessions.has(input.sessionID)) {
    return undefined
  }

  if (getMainSessionID() !== input.sessionID) {
    return undefined
  }

  if (input.model) {
    return undefined
  }

  if (hasExplicitAgentModelOverride(input.agent, pluginConfig)) {
    return undefined
  }

  return getSessionModel(input.sessionID)
}

export function recordSessionModel(input: ChatMessageInput, output: ChatMessageHandlerOutput): void {
  const modelOverride = output.message.model
  if (
    modelOverride &&
    typeof modelOverride === "object" &&
    "providerID" in modelOverride &&
    "modelID" in modelOverride
  ) {
    const providerID = (modelOverride as { readonly providerID?: string }).providerID
    const modelID = (modelOverride as { readonly modelID?: string }).modelID
    if (typeof providerID === "string" && typeof modelID === "string") {
      setSessionModel(input.sessionID, { providerID, modelID })
    }
  } else if (input.model) {
    setSessionModel(input.sessionID, input.model)
  }
}
