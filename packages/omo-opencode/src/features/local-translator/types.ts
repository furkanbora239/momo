export type TranslationMode = "cloud" | "local"

export interface CloudTranslationConfig {
  readonly provider: string
  readonly model: string
  readonly maxOutputTokens: number
}

export interface TranslationConfig {
  readonly enabled: boolean
  readonly mode: TranslationMode
  readonly model: string
  readonly ollamaHost: string
  readonly timeoutMs: number
  readonly autoInstall: boolean
  readonly minLength: number
  readonly logTranslations: boolean
  readonly showNotifications: boolean
  readonly numCtx: number
  readonly numPredict: number
  readonly cloud: CloudTranslationConfig
}

export type TranslationConfigInput = Omit<Partial<TranslationConfig>, "cloud"> & {
  readonly cloud?: Partial<CloudTranslationConfig>
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

export const DEFAULT_CLOUD_CONFIG: CloudTranslationConfig = {
  provider: "google",
  model: "gemma-4-31b-it",
  maxOutputTokens: 4096,
}

export const DEFAULT_TRANSLATION_CONFIG: TranslationConfig = {
  enabled: true,
  mode: "cloud",
  model: "qwen2.5:1.5b",
  ollamaHost: "http://localhost:11434",
  timeoutMs: 60000,
  autoInstall: false,
  minLength: 20,
  logTranslations: true,
  showNotifications: true,
  numCtx: 2048,
  numPredict: 128,
  cloud: DEFAULT_CLOUD_CONFIG,
}
