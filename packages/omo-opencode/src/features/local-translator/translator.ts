import type { TranslationConfig, TranslationResult } from "./types"
import { chatWithOllama } from "./ollama-client"
import { logTranslation } from "./translation-logger"

const SYSTEM_PROMPT = `You are a prompt translator. Translate the input to English. Then compress it: drop articles, filler, pleasantries, hedging. Keep technical terms, code blocks, file paths, function names, and URLs exact. Fragments are OK. Short synonyms preferred. Output ONLY the translated and compressed text. No explanations. No preamble.`

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
      model: config.model,
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
    const translated = await chatWithOllama(config, SYSTEM_PROMPT, text)
    const latencyMs = Date.now() - startTime

    const result: TranslationResult = {
      originalText: text,
      translatedText: translated,
      model: config.model,
      latencyMs,
      skipped: false,
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
      model: config.model,
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
