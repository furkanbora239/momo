import type { Message, Part } from "@opencode-ai/sdk"
import { isRealUserMessage, isRealUserTextPart, log } from "../../shared"
import type { TranslationConfig } from "./types"
import { DEFAULT_TRANSLATION_CONFIG } from "./types"
import { translateMessage } from "./translator"
import { ensureOllamaRunning, isOllamaInstalled, installOllama } from "./ollama-installer"
import { ensureModelPulled } from "./model-puller"
import { checkOllamaHealth } from "./ollama-client"

function resolveConfig(rawConfig: Partial<TranslationConfig> | undefined): TranslationConfig {
  return { ...DEFAULT_TRANSLATION_CONFIG, ...rawConfig }
}

interface MessageWithParts {
  info: Message
  parts: Part[]
}

let initializationPromise: Promise<boolean> | null = null

async function ensureOllamaReady(config: TranslationConfig): Promise<boolean> {
  if (initializationPromise) return initializationPromise

  initializationPromise = (async () => {
    if (await checkOllamaHealth(config.ollamaHost)) {
      await ensureModelPulled(config.ollamaHost, config.model)
      return true
    }

    if (!isOllamaInstalled()) {
      if (!config.autoInstall) {
        log("[local-translator] Ollama not installed and auto_install is false")
        return false
      }
      const installed = await installOllama()
      if (!installed) return false
    }

    const running = await ensureOllamaRunning(config.ollamaHost)
    if (!running) return false

    await ensureModelPulled(config.ollamaHost, config.model)
    return true
  })()

  return initializationPromise
}

export function createLocalTranslatorHook(
  rawConfig: Partial<TranslationConfig> | undefined,
) {
  const config = resolveConfig(rawConfig)

  return {
    "experimental.chat.messages.transform": async (
      _input: Record<string, never>,
      output: { messages: MessageWithParts[] },
    ): Promise<void> => {
      if (!config.enabled) return

      const { messages } = output
      if (messages.length === 0) return

      let lastUserMessageIndex = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i]?.info.role === "user") {
          lastUserMessageIndex = i
          break
        }
      }
      if (lastUserMessageIndex === -1) return

      const lastUserMessage = messages[lastUserMessageIndex]
      if (!lastUserMessage || !isRealUserMessage(lastUserMessage)) return

      const textPartIndex = lastUserMessage.parts.findIndex(
        (part) =>
          isRealUserTextPart(part) &&
          "text" in part &&
          typeof part.text === "string" &&
          part.text.length > 0,
      )
      if (textPartIndex === -1) return

      const textPart = lastUserMessage.parts[textPartIndex]
      const originalText = (textPart as { text: string }).text
      if (!originalText) return

      const ready = await ensureOllamaReady(config)
      if (!ready) {
        log("[local-translator] Ollama not ready, passing through original text")
        return
      }

      const result = await translateMessage(config, originalText)

      if (result.skipped) {
        log("[local-translator] Skipped translation", { reason: result.skipReason })
        return
      }

      ;(lastUserMessage.parts[textPartIndex] as { text: string }).text = result.translatedText

      log("[local-translator] Translated user message", {
        latencyMs: result.latencyMs,
        originalLength: originalText.length,
        translatedLength: result.translatedText.length,
      })
    },
  }
}
