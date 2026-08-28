import { existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { log } from "../../shared/logger"

function getOllamaInstallDir(): string {
  return join(homedir(), ".omo", "ollama")
}

function getOllamaBinPath(): string {
  const installDir = getOllamaInstallDir()
  return process.platform === "win32"
    ? join(installDir, "ollama.exe")
    : join(installDir, "bin", "ollama")
}

export function isOllamaInstalled(): boolean {
  return existsSync(getOllamaBinPath())
}

export async function installOllama(): Promise<boolean> {
  const installDir = getOllamaInstallDir()
  mkdirSync(installDir, { recursive: true })

  log("[local-translator] Installing Ollama...")

  if (process.platform === "win32") {
    log("[local-translator] Windows: please install Ollama from https://ollama.com/download")
    return false
  }

  const proc = Bun.spawn(["sh", "-c", "curl -fsSL https://ollama.com/install.sh | sh"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    log("[local-translator] Ollama install failed", { exitCode, stderr })
    return false
  }

  log("[local-translator] Ollama installed successfully")
  return true
}

export async function ensureOllamaRunning(host: string): Promise<boolean> {
  const { checkOllamaHealth } = await import("./ollama-client")
  if (await checkOllamaHealth(host)) return true

  log("[local-translator] Starting Ollama daemon...")

  Bun.spawn(["ollama", "serve"], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })

  for (let i = 0; i < 30; i++) {
    await Bun.sleep(1000)
    if (await checkOllamaHealth(host)) {
      log("[local-translator] Ollama daemon ready")
      return true
    }
  }

  log("[local-translator] Ollama daemon did not start within 30s")
  return false
}
