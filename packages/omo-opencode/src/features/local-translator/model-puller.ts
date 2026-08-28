import { log } from "../../shared/logger"

interface PullProgress {
  status: string
  digest?: string
  total?: number
  completed?: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(0)}MB`
}

function renderProgressBar(completed: number, total: number): string {
  if (!total || total === 0) return ""
  const percent = Math.round((completed / total) * 100)
  const filled = Math.floor(percent / 5)
  const bar = "#".repeat(filled) + ".".repeat(20 - filled)
  return `[${bar}] ${percent}% (${formatBytes(completed)}/${formatBytes(total)})`
}

export async function pullModel(
  host: string,
  model: string,
): Promise<boolean> {
  log(`[local-translator] Pulling ${model}...`)

  const response = await fetch(`${host}/api/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: model, stream: true }),
    signal: AbortSignal.timeout(600000),
  })

  if (!response.ok || !response.body) {
    log(`[local-translator] Pull failed: ${response.status}`)
    return false
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split("\n")
    buffer = lines.pop() ?? ""

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const progress = JSON.parse(line) as PullProgress
        if (progress.status === "downloading" && progress.total) {
          const bar = renderProgressBar(progress.completed ?? 0, progress.total)
          if (bar) {
            process.stdout.write(`\r[momo] Pulling ${model} ${bar}`)
          }
        } else if (progress.status === "success") {
          process.stdout.write("\n")
          log(`[local-translator] ${model} pulled successfully`)
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  return true
}

export async function ensureModelPulled(
  host: string,
  model: string,
): Promise<boolean> {
  const { listOllamaModels } = await import("./ollama-client")
  const models = await listOllamaModels(host)
  if (models.includes(model)) {
    log(`[local-translator] Model ${model} already available`)
    return true
  }

  return pullModel(host, model)
}
