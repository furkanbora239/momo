import type { TranslationConfig } from "./types"

interface OllamaChatRequest {
  model: string
  messages: { role: string; content: string }[]
  stream: false
  options: {
    temperature: number
    num_ctx: number
    num_predict: number
  }
}

interface OllamaChatResponse {
  message: { role: string; content: string }
  done: boolean
}

export async function checkOllamaHealth(host: string): Promise<boolean> {
  try {
    const response = await fetch(`${host}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

export async function listOllamaModels(host: string): Promise<string[]> {
  try {
    const response = await fetch(`${host}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return []
    const data = (await response.json()) as { models?: { name: string }[] }
    return (data.models ?? []).map((model) => model.name)
  } catch {
    return []
  }
}

export async function chatWithOllama(
  config: TranslationConfig,
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  const request: OllamaChatRequest = {
    model: config.model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
    stream: false,
    options: {
      temperature: 0.1,
      num_ctx: config.numCtx,
      num_predict: config.numPredict,
    },
  }

  const response = await fetch(`${config.ollamaHost}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(config.timeoutMs),
  })

  if (!response.ok) {
    throw new Error(`Ollama chat failed: ${response.status} ${response.statusText}`)
  }

  const data = (await response.json()) as OllamaChatResponse
  return data.message.content.trim()
}
