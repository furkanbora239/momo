export interface TranslationConfig {
  readonly enabled: boolean
  readonly model: string
  readonly ollamaHost: string
  readonly timeoutMs: number
  readonly autoInstall: boolean
  readonly minLength: number
  readonly logTranslations: boolean
  readonly numCtx: number
  readonly numPredict: number
}

export interface TranslationResult {
  readonly originalText: string
  readonly translatedText: string
  readonly model: string
  readonly latencyMs: number
  readonly skipped: boolean
  readonly skipReason?: string
}

export interface LogEntry {
  readonly timestamp: string
  readonly originalText: string
  readonly translatedText: string
  readonly model: string
  readonly latencyMs: number
  readonly skipped: boolean
  readonly skipReason?: string
}

export const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
  enabled: true,
  model: "qwen2.5:1.5b",
  ollamaHost: "http://localhost:11434",
  timeoutMs: 30000,
  autoInstall: true,
  minLength: 20,
  logTranslations: true,
  numCtx: 2048,
  numPredict: 128,
}
