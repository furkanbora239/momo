import type { AgentConfig } from "@opencode-ai/sdk";
import { getFrontierToolSchemaPermission } from "./frontier-tool-schema-guard";
import { buildClaudeThinkingConfig } from "./types";
import type { AgentMode } from "./types";

const SISYPHUS_DESCRIPTION =
  "Primary AI orchestrator. Plans, coordinates, delegates to specialized agents, and drives tasks to completion. (Orchestrator - momo)";

const SISYPHUS_THINKING_BUDGET_TOKENS = 10000;

function buildSisyphusPermission(model: string): AgentConfig["permission"] {
  return {
    question: "allow",
    call_omo_agent: "deny",
    ...getFrontierToolSchemaPermission(model),
  } as AgentConfig["permission"];
}

function buildBaseSisyphusAgentConfig(
  mode: AgentMode,
  model: string,
  prompt: string,
): AgentConfig {
  return {
    description: SISYPHUS_DESCRIPTION,
    mode,
    model,
    maxTokens: 64000,
    prompt,
    color: "#00CED1",
    permission: buildSisyphusPermission(model),
  };
}

export function buildGptSisyphusAgentConfig(
  mode: AgentMode,
  model: string,
  prompt: string,
): AgentConfig {
  return {
    ...buildBaseSisyphusAgentConfig(mode, model, prompt),
    reasoningEffort: "medium",
  };
}

export function buildGlmSisyphusAgentConfig(
  mode: AgentMode,
  model: string,
  prompt: string,
): AgentConfig {
  return buildBaseSisyphusAgentConfig(mode, model, prompt);
}

/**
 * Grok 4.5/4.6 are xAI reasoning models: they take a reasoning effort
 * (grok family caps allow low/medium/high) and reject Anthropic-style
 * thinking blocks, so this is the base config plus effort only.
 */
export function buildGrokSisyphusAgentConfig(
  mode: AgentMode,
  model: string,
  prompt: string,
): AgentConfig {
  return {
    ...buildBaseSisyphusAgentConfig(mode, model, prompt),
    reasoningEffort: "high",
  };
}

export function buildClaudeSisyphusAgentConfig(
  mode: AgentMode,
  model: string,
  prompt: string,
): AgentConfig {
  return {
    ...buildBaseSisyphusAgentConfig(mode, model, prompt),
    ...buildClaudeThinkingConfig(model, SISYPHUS_THINKING_BUDGET_TOKENS),
  };
}
