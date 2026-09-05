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
import { buildClaudeFable5SisyphusPrompt } from "./sisyphus/claude-fable-5";
import { buildClaudeOpus47SisyphusPrompt } from "./sisyphus/claude-opus-4-7";
import { buildClaudeOpus48SisyphusPrompt } from "./sisyphus/claude-opus-4-8";
import { buildClaudeOpus5SisyphusPrompt } from "./sisyphus/claude-opus-5";
import { buildGlm52SisyphusPrompt } from "./sisyphus/glm-5-2";
import { buildGpt54SisyphusPrompt } from "./sisyphus/gpt-5-4";
import { buildGpt55SisyphusPrompt } from "./sisyphus/gpt-5-5";
import { buildGrok4SisyphusPrompt } from "./sisyphus/grok-4";
import { buildKimiK26SisyphusPrompt } from "./sisyphus/kimi-k2-6";
import { buildKimiK27SisyphusPrompt } from "./sisyphus/kimi-k2-7";
import { buildKimiK3SisyphusPrompt } from "./sisyphus/kimi-k3";
import { buildMomoOrchestratorPrompt } from "./sisyphus/momo-orchestrator";
import { buildMomoCoreSections } from "./sisyphus/momo-core-sections";
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
  const family = resolveSisyphusPromptFamily(model);

  let config: AgentConfig;
  switch (family) {
    case "kimi-k3":
      config = buildGptSisyphusAgentConfig(
        MODE,
        model,
        buildKimiK3SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
      break;
    case "kimi-k2-7":
      config = buildGptSisyphusAgentConfig(
        MODE,
        model,
        buildKimiK27SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
      break;
    case "kimi-k2-6":
      config = buildGptSisyphusAgentConfig(
        MODE,
        model,
        buildKimiK26SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
      break;
    case "gpt-5-5":
      config = buildGptSisyphusAgentConfig(
        MODE,
        model,
        buildGpt55SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
      break;
    case "gpt-5-4":
      config = buildGptSisyphusAgentConfig(
        MODE,
        model,
        buildGpt54SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
      break;
    case "claude-fable-5":
      config = buildClaudeSisyphusAgentConfig(
        MODE,
        model,
        buildClaudeFable5SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
      break;
    case "claude-opus-5":
      config = buildClaudeSisyphusAgentConfig(
        MODE,
        model,
        buildClaudeOpus5SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
      break;
    case "claude-opus-4-8":
      config = buildClaudeSisyphusAgentConfig(
        MODE,
        model,
        buildClaudeOpus48SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
      break;
    case "claude-opus-4-7":
      config = buildClaudeSisyphusAgentConfig(
        MODE,
        model,
        buildClaudeOpus47SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
      break;
    case "glm-5-2":
      config = buildGlmSisyphusAgentConfig(
        MODE,
        model,
        buildGlm52SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
      break;
    case "grok-4":
      config = buildGrokSisyphusAgentConfig(
        MODE,
        model,
        buildGrok4SisyphusPrompt(model, agents, tools, skills, categories, useTaskSystem),
      );
      break;
    case "fallback": {
      // momo default: use the momo-orchestrator prompt (hard delegation + catalog-first + minimal output)
      // This is the default for all models that don't have a specific family variant.
      const basePrompt = buildMomoOrchestratorPrompt(
        model,
        agents,
        tools,
        skills,
        categories,
        useTaskSystem,
      );
      // Apply Gemini-specific overrides if this is a Gemini model
      const prompt = applyGeminiFallbackOverrides(model, basePrompt);
      config = isGptModel(model)
        ? buildGptSisyphusAgentConfig(MODE, model, prompt)
        : buildClaudeSisyphusAgentConfig(MODE, model, prompt);
      break;
    }
  }

  // Appending unconditionally would double-inject the fallback family, which
  // already embeds these sections via buildMomoOrchestratorPrompt.
  if (family !== "fallback") {
    config = {
      ...config,
      prompt: `${config.prompt ?? ""}\n\n${buildMomoCoreSections()}`,
    };
  }
  return config;
}
createSisyphusAgent.mode = MODE;
