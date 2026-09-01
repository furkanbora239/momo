import { readFileSync } from "node:fs"
import * as path from "node:path"
import type { TranslationConfig } from "./types"
import { getDataDir } from "../../shared/data-path"

const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
const API_KEY_ENV_VARS = [
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
] as const

interface GeminiPart {
  text?: string
  thought?: boolean
}

interface GeminiGenerateResponse {
  candidates?: {
    content?: { parts?: GeminiPart[] }
    finishReason?: string
  }[]
  error?: { message?: string }
}

export function isSupportedCloudProvider(provider: string): boolean {
  return provider === "google"
}

export function resolveGoogleApiKey(): string | null {
  for (const envVar of API_KEY_ENV_VARS) {
    const value = process.env[envVar]
    if (typeof value === "string" && value.length > 0) return value
  }

  try {
    const authPath = path.join(getDataDir(), "opencode", "auth.json")
    const parsed: unknown = JSON.parse(readFileSync(authPath, "utf-8"))
    if (parsed && typeof parsed === "object") {
      const entry = (parsed as Record<string, unknown>)["google"]
      if (entry && typeof entry === "object") {
        const key = (entry as Record<string, unknown>)["key"]
        if (typeof key === "string" && key.length > 0) return key
      }
    }
  } catch {
    return null
  }

  return null
}

export async function chatWithCloud(
  config: TranslationConfig,
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  const apiKey = resolveGoogleApiKey()
  if (!apiKey) {
    throw new Error("cloud_api_key_missing")
  }

  const model = config.cloud.model
  const response = await fetch(`${GEMINI_BASE_URL}/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: "user", parts: [{ text: userContent }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: config.cloud.maxOutputTokens,
      },
    }),
    signal: AbortSignal.timeout(config.timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`cloud chat failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as GeminiGenerateResponse
  if (data.error?.message) {
    throw new Error(`cloud chat failed: ${data.error.message}`)
  }

  const parts = data.candidates?.[0]?.content?.parts ?? []
  const finalText = parts
    .filter((part) => part.thought !== true && typeof part.text === "string")
    .map((part) => part.text as string)
    .join("")
    .trim()

  if (finalText.length === 0) {
    const finishReason = data.candidates?.[0]?.finishReason ?? "unknown"
    throw new Error(`cloud chat returned no text (finishReason: ${finishReason})`)
  }

  return finalText
}
