import type { OhMyOpenCodeConfig } from "../../config"
import type { MonitorManager } from "../../features/monitor"
import type { PluginContext } from "../types"

import {
  createClaudeCodeHooksHook,
  createKeywordDetectorHook,
  createMonitorStatusInjectorHook,
  createRepoMapInjectorHook,
  createTeamMailboxInjector,
  createTeamModeStatusInjector,
  createToolPairValidatorHook,
} from "../../hooks"
import {
  contextCollector,
  createContextInjectorMessagesTransformHook,
} from "../../features/context-injector"
import { createBtwSideContextInjectorHook } from "../../features/btw-side"
import { createLocalTranslatorHook } from "../../features/local-translator"
import { safeCreateHook } from "../../shared/safe-create-hook"

export type TransformHooks = {
  claudeCodeHooks: ReturnType<typeof createClaudeCodeHooksHook> | null
  keywordDetector: ReturnType<typeof createKeywordDetectorHook> | null
  btwSideContextInjector: ReturnType<typeof createBtwSideContextInjectorHook>
  contextInjectorMessagesTransform: ReturnType<typeof createContextInjectorMessagesTransformHook>
  teamModeStatusInjector: ReturnType<typeof createTeamModeStatusInjector> | null
  teamMailboxInjector: ReturnType<typeof createTeamMailboxInjector> | null
  toolPairValidator: ReturnType<typeof createToolPairValidatorHook> | null
  monitorStatusInjector: ReturnType<typeof createMonitorStatusInjectorHook> | null
  repoMapInjector: ReturnType<typeof createRepoMapInjectorHook> | null
  localTranslator: ReturnType<typeof createLocalTranslatorHook> | null
}

export function createTransformHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  isHookEnabled: (hookName: string) => boolean
  safeHookEnabled?: boolean
  monitorManager?: MonitorManager
}): TransformHooks {
  const { ctx, pluginConfig, isHookEnabled, monitorManager } = args
  const safeHookEnabled = args.safeHookEnabled ?? true

  const claudeCodeHooks = isHookEnabled("claude-code-hooks")
    ? safeCreateHook(
        "claude-code-hooks",
        () =>
          createClaudeCodeHooksHook(
            ctx,
            {
              disabledHooks: (pluginConfig.claude_code?.hooks ?? true) ? undefined : true,
              keywordDetectorDisabled: !isHookEnabled("keyword-detector"),
            },
            contextCollector,
          ),
        { enabled: safeHookEnabled },
      )
    : null

  const keywordDetector = isHookEnabled("keyword-detector")
    ? safeCreateHook(
        "keyword-detector",
        () =>
          createKeywordDetectorHook(
            ctx,
            contextCollector,
            undefined,
            pluginConfig.keyword_detector,
            pluginConfig.default_mode,
          ),
        { enabled: safeHookEnabled },
      )
    : null

  const contextInjectorMessagesTransform =
    createContextInjectorMessagesTransformHook(contextCollector)
  const btwSideContextInjector = createBtwSideContextInjectorHook({
    client: ctx.client,
  })

  const teamModeConfig = pluginConfig.team_mode

  const teamModeStatusInjector = teamModeConfig?.enabled
    ? safeCreateHook(
        "team-mode-status-injector",
        () => createTeamModeStatusInjector(teamModeConfig, pluginConfig.keyword_detector),
        { enabled: safeHookEnabled },
      )
    : null

  const teamMailboxInjector = teamModeConfig?.enabled
    ? safeCreateHook(
        "team-mailbox-injector",
        () => createTeamMailboxInjector(ctx, teamModeConfig),
        { enabled: safeHookEnabled },
      )
    : null

  const toolPairValidator = isHookEnabled("tool-pair-validator")
    ? safeCreateHook(
        "tool-pair-validator",
        () => createToolPairValidatorHook(),
        { enabled: safeHookEnabled },
      )
    : null

  const monitorConfig = pluginConfig.monitor
  const monitorStatusInjector = monitorConfig?.enabled && monitorManager && isHookEnabled("monitor-status-injector")
    ? safeCreateHook(
        "monitor-status-injector",
        () => createMonitorStatusInjectorHook(monitorManager, { enabled: monitorConfig.enabled }),
        { enabled: safeHookEnabled },
      )
    : null

  const repoMapConfig = pluginConfig.repo_map
  const repoMapInjector = repoMapConfig?.enabled === true && isHookEnabled("repo-map-injector")
    ? safeCreateHook(
        "repo-map-injector",
        () => createRepoMapInjectorHook({ directory: ctx.directory }, repoMapConfig),
        { enabled: safeHookEnabled },
      )
    : null

  const localTranslatorConfig = pluginConfig.local_translator
  const localTranslatorEnabled = localTranslatorConfig?.enabled !== false
  const localTranslator = localTranslatorEnabled
    ? safeCreateHook(
        "local-translator",
        () =>
          createLocalTranslatorHook({
            enabled: localTranslatorConfig?.enabled !== false,
            model: localTranslatorConfig?.model,
            ollamaHost: localTranslatorConfig?.ollama_host,
            timeoutMs: localTranslatorConfig?.timeout_ms,
            autoInstall: localTranslatorConfig?.auto_install,
            minLength: localTranslatorConfig?.min_length,
            logTranslations: localTranslatorConfig?.log_translations,
            numCtx: localTranslatorConfig?.num_ctx,
            numPredict: localTranslatorConfig?.num_predict,
          }),
        { enabled: safeHookEnabled },
      )
    : null

  return {
    claudeCodeHooks,
    keywordDetector,
    btwSideContextInjector,
    contextInjectorMessagesTransform,
    teamModeStatusInjector,
    teamMailboxInjector,
    toolPairValidator,
    monitorStatusInjector,
    repoMapInjector,
    localTranslator,
  }
}
