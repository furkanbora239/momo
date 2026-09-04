import { z } from "zod"

const CloudTranslationSchema = z
  .object({
    provider: z
      .enum(["google"])
      .optional()
      .describe("Cloud translation provider. Only google (Gemini API) is supported. Default: google."),
    model: z
      .string()
      .optional()
      .describe("Cloud model used for translation. Default: gemma-4-31b-it (free tier)."),
    max_output_tokens: z
      .number()
      .optional()
      .describe("Max output tokens per translation call (reasoning tokens included). Default: 4096."),
  })
  .optional()

export const LocalTranslatorConfigSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe("Enable prompt translator. Default: true."),
    mode: z
      .enum(["cloud", "local"])
      .optional()
      .describe(
        "Translation backend. cloud = free Google Gemma via Gemini API, local = Ollama on this machine. Default: cloud.",
      ),
    model: z
      .string()
      .optional()
      .describe("Ollama model tag used when mode is local. Default: qwen2.5:1.5b."),
    ollama_host: z
      .string()
      .optional()
      .describe("Ollama API host. Default: http://localhost:11434."),
    timeout_ms: z
      .number()
      .optional()
      .describe("Translation timeout in milliseconds. Default: 60000."),
    auto_install: z
      .boolean()
      .optional()
      .describe(
        "Auto-install Ollama user-locally under ~/.omo/ollama (no sudo, Linux only) when missing. Default: false.",
      ),
    min_length: z
      .number()
      .optional()
      .describe("Skip translation for messages shorter than this (chars). Default: 20."),
    log_translations: z
      .boolean()
      .optional()
      .describe("Log translation I/O to ~/.omo/local-translator-logs/ for finetuning. Default: true."),
    show_notifications: z
      .boolean()
      .optional()
      .describe("Show TUI toast notifications during and after prompt translation. Default: true."),
    num_ctx: z
      .number()
      .optional()
      .describe("Ollama context window for translation model. Default: 2048."),
    num_predict: z
      .number()
      .optional()
      .describe("Max output tokens for Ollama translation. Default: 128."),
    cloud: CloudTranslationSchema,
  })
  .optional()

export type LocalTranslatorConfig = z.infer<typeof LocalTranslatorConfigSchema>
