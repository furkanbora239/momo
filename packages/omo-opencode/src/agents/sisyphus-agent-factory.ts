import type { AgentConfig } from "@opencode-ai/sdk";
import { categorizeTools } from "./dynamic-agent-prompt-builder";
import type {
  AvailableAgent,
  AvailableCategory,
  AvailableSkill,
} from "./dynamic-agent-prompt-builder";
import {
  buildClaudeSisyphusAgentConfig,
  buildGlmSisyphusAgentConfig,
  buildGptSisyphusAgentConfig,
  buildGrokSisyphusAgentConfig,
} from "./sisyphus-agent-config";
import { applyGeminiFallbackOverrides } from "./sisyphus-gemini-fallback-overrides";
import { buildMomoOrchestratorPrompt } from "./sisyphus/momo-orchestrator";
import type { AgentMode } from "./types";
import {
  isClaudeFable5Model,
  isClaudeOpus47Model,
  isClaudeOpus48Model,
  isClaudeOpus5Model,
  isGlmModel,
  isGpt5_5Model,
  isGpt5_6Model,
  isGptModel,
  isGptNativeSisyphusModel,
  isGrok45Model,
  isGrok46Model,
  isKimiK2Model,
  isKimiK27Model,
  isKimiK3Model,
} from "./types";

const MODE: AgentMode = "primary";

/**
 * Identifies which prompt body `createSisyphusAgent` bakes for a given model.
 * The whole Sisyphus prompt is model-family-specific and selected here, so this
 * is the single source of truth shared with the runtime reconciler: when the TUI
 * runtime model resolves to a different family than the configured one, the baked
 * body is the wrong family and must be rebuilt (issue #5297/#5316).
 */
export type SisyphusPromptFamily =
  | "kimi-k3"
  | "kimi-k2-7"
  | "kimi-k2-6"
  | "gpt-5-5"
  | "gpt-5-4"
  | "claude-fable-5"
  | "claude-opus-5"
  | "claude-opus-4-8"
  | "claude-opus-4-7"
  | "glm-5-2"
  | "grok-4"
  | "fallback";

export function resolveSisyphusPromptFamily(model: string): SisyphusPromptFamily {
  if (isKimiK3Model(model)) return "kimi-k3";
  if (isKimiK27Model(model)) return "kimi-k2-7";
  if (isKimiK2Model(model)) return "kimi-k2-6";
  if (isGpt5_5Model(model) || isGpt5_6Model(model)) return "gpt-5-5";
  if (isGptNativeSisyphusModel(model)) return "gpt-5-4";
  if (isClaudeFable5Model(model)) return "claude-fable-5";
  if (isClaudeOpus5Model(model)) return "claude-opus-5";
  if (isClaudeOpus48Model(model)) return "claude-opus-4-8";
  if (isClaudeOpus47Model(model)) return "claude-opus-4-7";
  if (isGlmModel(model)) return "glm-5-2";
  if (isGrok45Model(model) || isGrok46Model(model)) return "grok-4";
  return "fallback";
}

export function createSisyphusAgent(
  model: string,
  availableAgents?: AvailableAgent[],
  availableToolNames?: string[],
  availableSkills?: AvailableSkill[],
  availableCategories?: AvailableCategory[],
  useTaskSystem = false,
): AgentConfig {
  const tools = availableToolNames ? categorizeTools(availableToolNames) : [];
  const skills = availableSkills ?? [];
  const categories = availableCategories ?? [];
  const agents = availableAgents ?? [];

  // momo ships ONE orchestrator prompt for every model family. Current models are
  // capable enough that per-family tuning buys little while costing a lot of drift:
  // every new model lands in a stale variant written for an older one, and the baked
  // body then disagrees with the runtime model (issue #5297/#5316). The single body
  // already embeds the momo core sections, so nothing is appended here.
  const prompt = buildMomoOrchestratorPrompt(
    model,
    agents,
    tools,
    skills,
    categories,
    useTaskSystem,
  );
  const config: AgentConfig = isGptModel(model)
    ? buildGptSisyphusAgentConfig(MODE, model, prompt)
    : buildClaudeSisyphusAgentConfig(MODE, model, prompt);
  return config;
}
createSisyphusAgent.mode = MODE;
