export { createLocalTranslatorHook } from "./hook"
export { checkOllamaHealth, listOllamaModels, chatWithOllama } from "./ollama-client"
export { chatWithCloud, resolveGoogleApiKey, isSupportedCloudProvider } from "./cloud-client"
export {
  isOllamaInstalled,
  installOllama,
  ensureOllamaRunning,
  resolveOllamaBinary,
} from "./ollama-installer"
export { pullModel, ensureModelPulled } from "./model-puller"
export { translateMessage, shouldSkipTranslation } from "./translator"
export { logTranslation } from "./translation-logger"
export { DEFAULT_TRANSLATION_CONFIG } from "./types"
export type {
  TranslationConfig,
  TranslationResult,
  LogEntry,
  TranslationMode,
  CloudTranslationConfig,
} from "./types"
