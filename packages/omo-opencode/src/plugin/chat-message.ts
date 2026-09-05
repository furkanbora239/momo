import type { OhMyOpenCodeConfig } from "../config"

import { subagentSessions, updateSessionAgent } from "../features/claude-code-session-state"
import { detectSlashCommand, extractPromptText } from "../hooks/auto-slash-command/detector"
import {
  isRuntimeFallbackRetryTextParts,
  isSyntheticOrInternalOnlyTextParts,
  log,
} from "../shared"
import { getAgentConfigKey } from "../shared/agent-display-names"
import { getSessionModel } from "../shared/session-model-state"
import { applyUltraworkModelOverrideOnMessage } from "./ultrawork-model-override"
import type { PluginContext } from "./types"
import { handleGoalMessage } from "./chat-message/loop-commands"
import { notifyWhenModelCacheIsMissing } from "./chat-message/model-cache-warning"
import { recordSessionModel, getStoredMainSessionModel } from "./chat-message/session-model"
import { runStartWorkHookIfApplicable } from "./chat-message/start-work-message"
import { consumeNativeGoalCommandMarker } from "./command-execute-before"
import { stopContinuation } from "./stop-continuation"
import type {
  ChatMessageHandlerOutput,
  ChatMessageHooks,
  ChatMessageInput,
  FirstMessageVariantGate,
} from "./chat-message/types"

export type { ChatMessageHandlerOutput, ChatMessageInput } from "./chat-message/types"

type PluginContextWithTui = {
  readonly client?: {
    readonly tui?: {
      readonly showToast?: (input: {
        readonly body: {
          readonly title: string
          readonly message: string
          readonly variant: "warning"
          readonly duration: number
        }
      }) => Promise<unknown>
    }
  }
}

function isRuntimeFallbackEnabled(
  hooks: ChatMessageHooks,
  pluginConfig: OhMyOpenCodeConfig,
): boolean {
  return (
    hooks.runtimeFallback !== null &&
    hooks.runtimeFallback !== undefined &&
    (typeof pluginConfig.runtime_fallback === "boolean"
      ? pluginConfig.runtime_fallback
      : (pluginConfig.runtime_fallback?.enabled ?? false))
  )
}

async function runChatMessageHooks(args: {
  readonly input: ChatMessageInput
  readonly output: ChatMessageHandlerOutput
  readonly hooks: ChatMessageHooks
  readonly runtimeFallbackEnabled: boolean
}): Promise<void> {
  const { input, output, hooks, runtimeFallbackEnabled } = args
  if (!runtimeFallbackEnabled) {
    await hooks.modelFallback?.["chat.message"]?.(input, output)
  }
  recordSessionModel(input, output)
  await hooks.stopContinuationGuard?.["chat.message"]?.(input)
  await hooks.backgroundNotificationHook?.["chat.message"]?.(input, output)
  await hooks.runtimeFallback?.["chat.message"]?.(input, output)
  await hooks.keywordDetector?.["chat.message"]?.(input, output)
  await hooks.thinkMode?.["chat.message"]?.(input, output)
  await hooks.claudeCodeHooks?.["chat.message"]?.(input, output)
  await hooks.autoSlashCommand?.["chat.message"]?.(input, output)
  await hooks.noSisyphusGpt?.["chat.message"]?.(input, output)
  await hooks.noHephaestusNonGpt?.["chat.message"]?.(input, output)
  await hooks.hephaestusAgentsMdInjector?.["chat.message"]?.(input, output)
}

export function createChatMessageHandler(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  firstMessageVariantGate: FirstMessageVariantGate
  hooks: ChatMessageHooks
}): (
  input: ChatMessageInput,
  output: ChatMessageHandlerOutput
) => Promise<void> {
  const { ctx, pluginConfig, firstMessageVariantGate, hooks } = args
  const pluginContext = ctx as PluginContextWithTui
  const runtimeFallbackEnabled = isRuntimeFallbackEnabled(hooks, pluginConfig)

  return async (
    input: ChatMessageInput,
    output: ChatMessageHandlerOutput,
  ): Promise<void> => {
    const nativeGoalCommand = consumeNativeGoalCommandMarker(output.parts)
    if (isSyntheticOrInternalOnlyTextParts(output.parts)) {
      if (isRuntimeFallbackRetryTextParts(output.parts)) {
        await hooks.runtimeFallback?.["chat.message"]?.(input, output)
      }
      log("[chat-message] Skipping synthetic/internal-only message", {
        sessionID: input.sessionID,
      })
      return
    }

    if (input.agent) {
      updateSessionAgent(input.sessionID, input.agent)
    }

    const promptText = extractPromptText(output.parts).trim()
    const slashCommand = detectSlashCommand(promptText)
    if (slashCommand?.command === "stop-continuation") {
      stopContinuation({
        directory: ctx.directory,
        hooks,
        sessionID: input.sessionID,
      })
    }

    const isFirstMessage = firstMessageVariantGate.shouldOverride(input.sessionID)
    const storedMainSessionModel = getStoredMainSessionModel(
      input,
      pluginConfig,
      isFirstMessage,
    )
    if (storedMainSessionModel) {
      output.message.model = storedMainSessionModel
    }

    const agentKey = input.agent ? getAgentConfigKey(input.agent) : undefined
    const agentConfiguredModel = agentKey ? pluginConfig.agents?.[agentKey as keyof typeof pluginConfig.agents]?.model : undefined

    const hasExplicitModel = Boolean(
      (input.model && ((input.model.modelID && input.model.modelID.trim().length > 0) || ((input.model as unknown as { id?: string }).id && (input.model as unknown as { id: string }).id.trim().length > 0))) ||
      (typeof output.message.model === "string" && output.message.model.trim().length > 0) ||
      (output.message.model && typeof output.message.model === "object" && Boolean((output.message.model as { modelID?: string }).modelID || (output.message.model as { id?: string }).id)) ||
      getSessionModel(input.sessionID)
    )

    const isGoalAction = nativeGoalCommand ||
      ["pause", "resume", "clear"].includes(promptText.toLowerCase()) ||
      promptText.startsWith("/goal")

    if (
      promptText.length > 0 &&
      !hasExplicitModel &&
      !agentConfiguredModel &&
      !slashCommand &&
      !isGoalAction &&
      !subagentSessions.has(input.sessionID)
    ) {
      if (pluginContext.client?.tui?.showToast) {
        await pluginContext.client.tui.showToast({
          body: {
            title: "No Model Selected",
            message: "Please select a model first using /models before sending prompts.",
            variant: "warning",
            duration: 5000,
          },
        }).catch(() => {})
      }
      throw new Error("No model selected. Please select a model first using /models.")
    }

    if (isFirstMessage) {
      firstMessageVariantGate.markApplied(input.sessionID)
    }

    await runChatMessageHooks({
      input,
      output,
      hooks,
      runtimeFallbackEnabled,
    })
    await runStartWorkHookIfApplicable(hooks, input, output)
    if (pluginContext.client?.tui) {
      notifyWhenModelCacheIsMissing(pluginContext.client.tui as Parameters<typeof notifyWhenModelCacheIsMissing>[0])
    }
    handleGoalMessage({
      hooks,
      input,
      output,
      isFirstMessage,
      pluginConfig,
      nativeGoalCommand,
    })
    await applyUltraworkModelOverrideOnMessage(
      pluginConfig,
      input.agent,
      output,
      pluginContext.client?.tui,
      input.sessionID,
      pluginContext.client,
    )
  }
}
