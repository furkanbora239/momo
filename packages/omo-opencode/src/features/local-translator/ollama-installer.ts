import { existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { bunWhich } from "../../shared/bun-which-shim"
import { log } from "../../shared/logger"
import { spawn } from "../../shared/bun-spawn-shim"
import { readProcessStream } from "../../shared/process-stream-reader"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

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
  if (existsSync(getOllamaBinPath())) return true
  return bunWhich("ollama") !== null
}

export function resolveOllamaBinary(): string {
  const localBin = getOllamaBinPath()
  if (existsSync(localBin)) return localBin
  return bunWhich("ollama") ?? "ollama"
}

function getLinuxTarballUrl(): string {
  const arch = process.arch === "arm64" ? "arm64" : "amd64"
  return `https://ollama.com/download/ollama-linux-${arch}.tgz`
}

export async function installOllama(): Promise<boolean> {
  const installDir = getOllamaInstallDir()

  if (process.platform !== "linux") {
    log(
      `[local-translator] Automatic Ollama install is only supported on Linux. ` +
        `Install Ollama manually from https://ollama.com/download`,
    )
    return false
  }

  mkdirSync(installDir, { recursive: true })
  log(`[local-translator] Installing Ollama into ${installDir} (user-local, no sudo)...`)

  const proc = spawn(
    ["sh", "-c", `curl -fsSL ${getLinuxTarballUrl()} | tar -xzf - -C "${installDir}"`],
    {
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    },
  )
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = proc.stderr ? await readProcessStream(proc.stderr) : ""
    log("[local-translator] Ollama install failed", { exitCode, stderr })
    return false
  }

  if (!existsSync(getOllamaBinPath())) {
    log("[local-translator] Ollama install finished but binary is missing")
    return false
  }

  log("[local-translator] Ollama installed successfully")
  return true
}

export async function ensureOllamaRunning(host: string): Promise<boolean> {
  const { checkOllamaHealth } = await import("./ollama-client")
  if (await checkOllamaHealth(host)) return true

  log("[local-translator] Starting Ollama daemon...")

  spawn([resolveOllamaBinary(), "serve"], {
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  })

  for (let i = 0; i < 30; i++) {
    await sleep(1000)
    if (await checkOllamaHealth(host)) {
      log("[local-translator] Ollama daemon ready")
      return true
    }
  }

  log("[local-translator] Ollama daemon did not start within 30s")
  return false
}
