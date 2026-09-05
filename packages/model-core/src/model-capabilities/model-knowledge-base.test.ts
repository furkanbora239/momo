import { describe, expect, test } from "bun:test"
import {
  getModelProfile,
  getModelsByRole,
  getModelsByProvider,
  normalizeKnowledgeBaseKey,
  MODEL_KNOWLEDGE_BASE,
} from "./model-knowledge-base"

describe("model-knowledge-base", () => {
  test("#given raw provider-prefixed IDs #when normalized #then extracts base model key", () => {
    expect(normalizeKnowledgeBaseKey("opencode-go/glm-5.3-flash")).toBe("glm-5.3-flash")
    expect(normalizeKnowledgeBaseKey("neuralwatt/kimi-k3")).toBe("kimi-k3")
    expect(normalizeKnowledgeBaseKey("opencode/claude-opus-5:max")).toBe("claude-opus-5")
  })

  test("#given canonical model ID #when getModelProfile called #then returns rich profile", () => {
    const glm = getModelProfile("opencode-go/glm-5.3-flash")
    expect(glm).toBeDefined()
    expect(glm?.canonicalId).toBe("glm-5.3-flash")
    expect(glm?.displayName).toBe("GLM 5.3 Flash")
    expect(glm?.benchmarks.contextWindowTokens).toBe(1_000_000)
    expect(glm?.benchmarks.reasoningSupported).toBe(true)
    expect(glm?.strengths.length).toBeGreaterThan(0)
    expect(glm?.bestUseCases.length).toBeGreaterThan(0)
    expect(glm?.costTier).toBe("budget")
  })

  test("#given neuralwatt kimi-k3 #when queried #then carries prompt caching note and orchestrator role", () => {
    const kimi = getModelProfile("neuralwatt/kimi-k3")
    expect(kimi).toBeDefined()
    expect(kimi?.primaryRole).toBe("orchestrator")
    expect(kimi?.availableProviders).toContain("neuralwatt")
    expect(kimi?.providerNotes?.neuralwatt).toContain("caching")
  })

  test("#given qwen3.8-flash #when queried #then recommended for quick and dispatcher", () => {
    const qwen = getModelProfile("go-b/qwen3.8-flash")
    expect(qwen).toBeDefined()
    expect(qwen?.latencyTier).toBe("ultra_fast")
    expect(qwen?.costTier).toBe("budget")
  })

  test("#given role search #when getModelsByRole called #then returns matching models", () => {
    const planners = getModelsByRole("lead_planner")
    expect(planners.length).toBeGreaterThan(0)
    expect(planners.some((m) => m.canonicalId === "glm-5.3-flash")).toBe(true)

    const explorers = getModelsByRole("worker_explore")
    expect(explorers.some((m) => m.canonicalId === "deepseek-v4-flash")).toBe(true)
  })

  test("#given provider search #when getModelsByProvider called #then returns models for provider", () => {
    const goModels = getModelsByProvider("opencode-go")
    expect(goModels.length).toBeGreaterThan(0)
    expect(goModels.some((m) => m.canonicalId === "hy3")).toBe(true)
    expect(goModels.some((m) => m.canonicalId === "glm-5.3-flash")).toBe(true)

    const nwModels = getModelsByProvider("neuralwatt")
    expect(nwModels.some((m) => m.canonicalId === "kimi-k3")).toBe(true)
    expect(nwModels.some((m) => m.canonicalId === "claude-opus-5")).toBe(true)
  })

  test("#given all entries in knowledge base #then all have non-empty descriptions, strengths, and benchmarks", () => {
    for (const [id, entry] of Object.entries(MODEL_KNOWLEDGE_BASE)) {
      expect(entry.canonicalId).toBe(id)
      expect(entry.description.length).toBeGreaterThan(10)
      expect(entry.strengths.length).toBeGreaterThan(0)
      expect(entry.weaknesses.length).toBeGreaterThan(0)
      expect(entry.bestUseCases.length).toBeGreaterThan(0)
      expect(entry.benchmarks.contextWindowTokens).toBeGreaterThan(0)
      expect(entry.benchmarks.maxOutputTokens).toBeGreaterThan(0)
    }
  })

  test("#given omen-alpha #when queried #then exists with valid benchmark and provider fields and no supersededBy", () => {
    const omen = getModelProfile("opencode-go/omen-alpha")
    expect(omen).toBeDefined()
    expect(omen?.canonicalId).toBe("omen-alpha")
    expect(omen?.displayName).toBe("Omen Alpha")
    expect(omen?.benchmarks.sweBenchScorePercentEst).toBeGreaterThanOrEqual(0)
    expect(omen?.benchmarks.sweBenchScorePercentEst).toBeLessThanOrEqual(100)
    const validProviders = [
      "opencode",
      "opencode-go",
      "go-b",
      "neuralwatt",
      "openai",
      "anthropic",
      "google",
      "deepseek",
      "alibaba",
      "moonshotai",
      "minimax",
      "xiaomi",
      "zai",
    ]
    for (const provider of omen?.availableProviders ?? []) {
      expect(validProviders).toContain(provider)
    }
    expect(omen?.supersededBy).toBeUndefined()
  })

  test("#given supersededBy references #when validated #then they point at existing entries and never at themselves", () => {
    const entries = Object.entries(MODEL_KNOWLEDGE_BASE)
    expect(entries.some(([, entry]) => entry.supersededBy !== undefined)).toBe(true)
    for (const [id, entry] of entries) {
      if (entry.supersededBy === undefined) continue
      expect(MODEL_KNOWLEDGE_BASE[entry.supersededBy]).toBeDefined()
      expect(entry.supersededBy).not.toBe(entry.canonicalId)
      expect(entry.supersededBy).not.toBe(id)
    }
  })
})
