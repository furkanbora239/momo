import { log } from "../../shared/logger"

export const EVREN_PROVIDER_ID = "evren"
export const EVREN_BASE_URL = "https://evren-llmapi.ssyz.org.tr/v1"

export type EvrenModelConfig = {
  name: string
  limit: { context: number; output: number }
  modalities?: { input: string[] }
}

export type EvrenProviderConfig = {
  npm: string
  name: string
  options: { baseURL: string }
  models: Record<string, EvrenModelConfig>
}

function textOnly(name: string, context: number, output: number): EvrenModelConfig {
  return { name, limit: { context, output } }
}

function textAndImage(name: string, context: number, output: number): EvrenModelConfig {
  return {
    name,
    limit: { context, output },
    modalities: { input: ["text", "image"] },
  }
}

function buildEvrenProviderConfig(): EvrenProviderConfig {
  return {
    npm: "@ai-sdk/openai-compatible",
    name: "EVREN LLM",
    options: { baseURL: EVREN_BASE_URL },
    models: {
      "auto": textOnly("EVREN Auto", 128000, 8192),
      "glm-5.3": textOnly("GLM 5.3", 200000, 16384),
      "deepseek-v4-flash": textOnly("DeepSeek V4 Flash", 128000, 8192),
      "qwen3.8-flash-next": textAndImage("Qwen3.8 Flash Next", 128000, 8192),
      "gemma-4-31b": textAndImage("Gemma 4 31B", 128000, 8192),
      "qwen3-vl-30b": textAndImage("Qwen3 VL 30B", 128000, 8192),
    },
  }
}

function deepFreeze(value: unknown): void {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) {
      deepFreeze(child)
    }
  }
}

const evrenProviderConfig = buildEvrenProviderConfig()
deepFreeze(evrenProviderConfig)

/**
 * Built-in EVREN LLM provider entry (Turkish SSB gateway, OpenAI-compatible).
 * Frozen deeply; applyBuiltinEvrenProvider injects a fresh clone per call so
 * callers can never mutate this shared constant.
 */
export const EVREN_PROVIDER_CONFIG: EvrenProviderConfig = evrenProviderConfig

function cloneEvrenProviderConfig(): EvrenProviderConfig {
  return structuredClone(EVREN_PROVIDER_CONFIG)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Injects the built-in EVREN provider into an OpenCode config object.
 *
 * Injection happens ONLY when opts.consented === true (the user accepted the
 * EVREN terms). A missing config.provider map is created; a non-object
 * provider value is left untouched, and an existing evren entry is never
 * overwritten. Never throws.
 */
export function applyBuiltinEvrenProvider(
  config: Record<string, unknown>,
  opts: { consented: boolean },
): void {
  try {
    if (opts.consented !== true) return
    const existing = config.provider
    if (existing !== undefined && !isRecord(existing)) return
    const provider = existing === undefined
      ? (config.provider = {} as Record<string, unknown>)
      : existing
    if (Object.prototype.hasOwnProperty.call(provider, EVREN_PROVIDER_ID)) return
    provider[EVREN_PROVIDER_ID] = cloneEvrenProviderConfig()
  } catch (error) {
    log("[evren-provider] Error applying built-in evren provider", {
      error: String(error),
    })
  }
}
