import { existsSync } from "node:fs"
import { spawn } from "node:child_process"
import { buildCodegraphChildEnv } from "@oh-my-opencode/utils"
import { resolveCodegraphCommandInvocation } from "./command-runner"

export interface WarmupCodegraphMcpOptions {
  readonly argsPrefix?: readonly string[]
  readonly command: string
  readonly env: Record<string, string>
  readonly log?: (message: string, data?: Record<string, unknown>) => void
  readonly projectRoot: string
  readonly timeoutMs?: number
}

export interface WarmupCodegraphMcpResult {
  readonly durationMs: number
  readonly error?: string
  readonly success: boolean
  readonly timedOut?: boolean
}

const DEFAULT_WARMUP_TIMEOUT_MS = 15_000

export async function warmupCodegraphMcp(options: WarmupCodegraphMcpOptions): Promise<WarmupCodegraphMcpResult> {
  const start = Date.now()
  const timeoutMs = options.timeoutMs ?? DEFAULT_WARMUP_TIMEOUT_MS

  if (!existsSync(options.projectRoot)) {
    return {
      durationMs: 0,
      error: `projectRoot does not exist: ${options.projectRoot}`,
      success: false,
    }
  }

  return new Promise((resolve) => {
    let finished = false

    const complete = (result: Partial<WarmupCodegraphMcpResult> & { success: boolean }): void => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      try {
        if (!child.killed) {
          child.stdin?.end?.()
          child.kill("SIGTERM")
        }
      } catch {
        // ignore process teardown errors
      }
      resolve({
        durationMs: Date.now() - start,
        ...result,
      })
    }

    const invocation = resolveCodegraphCommandInvocation(
      options.command,
      [...options.argsPrefix ?? [], "serve", "--mcp", "--path", options.projectRoot],
    )

    const child = spawn(invocation.command, invocation.args, {
      cwd: options.projectRoot,
      env: buildCodegraphChildEnv({ ambientEnv: process.env, codegraphEnv: options.env }),
      stdio: ["pipe", "pipe", "ignore"],
    })

    const timer = setTimeout(() => {
      complete({ success: false, timedOut: true })
    }, timeoutMs)
    timer.unref?.()

    let buffer = ""
    child.stdout?.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString()
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const resp = JSON.parse(line) as { id?: number; error?: unknown }
          if (resp.id === 1) {
            child.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n")
            child.stdin?.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                method: "tools/call",
                params: { name: "codegraph_status", arguments: {} },
              }) + "\n",
            )
          } else if (resp.id === 2) {
            complete({ success: true })
            return
          }
        } catch {
          // ignore non-JSON lines or protocol chatter
        }
      }
    })

    child.on("error", (error) => {
      complete({ error: error.message, success: false })
    })

    child.on("exit", (code) => {
      if (!finished) {
        complete({ error: `probe exited with code ${code ?? "null"}`, success: false })
      }
    })

    try {
      child.stdin?.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2024-11-05",
            capabilities: {},
            clientInfo: { name: "momo-codegraph-warmup", version: "1.0.0" },
          },
        }) + "\n",
      )
    } catch (error) {
      complete({ error: error instanceof Error ? error.message : String(error), success: false })
    }
  })
}
