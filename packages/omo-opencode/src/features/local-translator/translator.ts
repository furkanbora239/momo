import type { TranslationConfig, TranslationResult } from "./types"
import { chatWithOllama } from "./ollama-client"
import { chatWithCloud } from "./cloud-client"
import { logTranslation } from "./translation-logger"
import { log } from "../../shared/logger"

function isBudgetExhaustionError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("finishReason: MAX_TOKENS")
}

const SYSTEM_PROMPT = `You are a prompt translator. Translate the input to English. Then compress it: drop articles, filler, pleasantries, hedging. Keep technical terms, code blocks, file paths, function names, and URLs exact. Fragments are OK. Short synonyms preferred. Output ONLY the translated and compressed text. No explanations. No preamble.`

const MAX_CACHE_ENTRIES = 50

const translationCache = new Map<string, TranslationResult>()

export function cacheKeyFor(config: TranslationConfig, text: string): string {
  return `${config.mode}\u0000${resolveTranslationModelLabel(config)}\u0000${text}`
}

export function _resetTranslationCacheForTesting(): void {
  translationCache.clear()
}

export function shouldSkipTranslation(
  text: string,
  minLength: number,
): { skip: boolean; reason?: string } {
  const trimmed = text.trim()
  if (trimmed.length < minLength) {
    return { skip: true, reason: "below_min_length" }
  }
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    return { skip: true, reason: "pure_code_block" }
  }
  if (/^(\/|\.\/|\.\.\/|https?:\/\/|~\/)/.test(trimmed) && !trimmed.includes(" ")) {
    return { skip: true, reason: "path_or_url_only" }
  }
  return { skip: false }
}

export function resolveTranslationModelLabel(config: TranslationConfig): string {
  if (config.mode === "cloud") {
    return `${config.cloud.provider}/${config.cloud.model}`
  }
  return config.model
}

export async function translateMessage(
  config: TranslationConfig,
  text: string,
): Promise<TranslationResult> {
  const startTime = Date.now()
  const skipCheck = shouldSkipTranslation(text, config.minLength)

  if (skipCheck.skip) {
    const result: TranslationResult = {
      originalText: text,
      translatedText: text,
      model: resolveTranslationModelLabel(config),
      latencyMs: 0,
      skipped: true,
      skipReason: skipCheck.reason,
    }
    if (config.logTranslations) {
      logTranslation({ timestamp: new Date().toISOString(), ...result })
    }
    return result
  }

  try {
    const cacheKey = cacheKeyFor(config, text)
    const cached = translationCache.get(cacheKey)
    if (cached && !cached.skipped) {
      return { ...cached, latencyMs: 0 }
    }

    let translated: string
    if (config.mode === "cloud") {
      try {
        translated = await chatWithCloud(config, SYSTEM_PROMPT, text)
      } catch (firstError) {
        if (!isBudgetExhaustionError(firstError)) throw firstError
        const doubled = config.cloud.maxOutputTokens * 2
        log("[local-translator] Retrying cloud translation with doubled maxOutputTokens", {
          from: config.cloud.maxOutputTokens,
          to: doubled,
        })
        if (config.logTranslations) {
          logTranslation({
            timestamp: new Date().toISOString(),
            originalText: text,
            translatedText: text,
            model: resolveTranslationModelLabel(config),
            latencyMs: Date.now() - startTime,
            skipped: true,
            skipReason: `retry: doubled maxOutputTokens to ${doubled} after MAX_TOKENS`,
          })
        }
        const retryConfig: TranslationConfig = {
          ...config,
          cloud: { ...config.cloud, maxOutputTokens: doubled },
        }
        translated = await chatWithCloud(retryConfig, SYSTEM_PROMPT, text)
      }
    } else {
      translated = await chatWithOllama(config, SYSTEM_PROMPT, text)
    }
    const latencyMs = Date.now() - startTime

    const result: TranslationResult = {
      originalText: text,
      translatedText: translated,
      model: resolveTranslationModelLabel(config),
      latencyMs,
      skipped: false,
    }

    translationCache.set(cacheKey, result)
    if (translationCache.size > MAX_CACHE_ENTRIES) {
      const oldest = translationCache.keys().next().value
      if (oldest !== undefined) translationCache.delete(oldest)
    }

    if (config.logTranslations) {
      logTranslation({ timestamp: new Date().toISOString(), ...result })
    }

    return result
  } catch (error) {
    const latencyMs = Date.now() - startTime
    const result: TranslationResult = {
      originalText: text,
      translatedText: text,
      model: resolveTranslationModelLabel(config),
      latencyMs,
      skipped: true,
      skipReason: `error: ${error instanceof Error ? error.message : String(error)}`,
    }

    if (config.logTranslations) {
      logTranslation({ timestamp: new Date().toISOString(), ...result })
    }

    return result
  }
}
