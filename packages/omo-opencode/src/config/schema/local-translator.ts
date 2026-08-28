import { z } from "zod"

export const LocalTranslatorConfigSchema = z
  .object({
    enabled: z
      .boolean()
      .optional()
      .describe("Enable local prompt translator. Default: true."),
    model: z
      .string()
      .optional()
      .describe("Ollama model tag for translation. Default: qwen2.5:1.5b."),
    ollama_host: z
      .string()
      .optional()
      .describe("Ollama API host. Default: http://localhost:11434."),
    timeout_ms: z
      .number()
      .optional()
      .describe("Translation timeout in milliseconds. Default: 30000."),
    auto_install: z
      .boolean()
      .optional()
      .describe("Auto-install Ollama if missing. Default: true."),
    min_length: z
      .number()
      .optional()
      .describe("Skip translation for messages shorter than this (chars). Default: 20."),
    log_translations: z
      .boolean()
      .optional()
      .describe("Log translation I/O to ~/.omo/local-translator-logs/ for finetuning. Default: true."),
    num_ctx: z
      .number()
      .optional()
      .describe("Ollama context window for translation model. Default: 2048."),
    num_predict: z
      .number()
      .optional()
      .describe("Max output tokens for translation. Default: 128."),
  })
  .optional()

export type LocalTranslatorConfig = z.infer<typeof LocalTranslatorConfigSchema>
