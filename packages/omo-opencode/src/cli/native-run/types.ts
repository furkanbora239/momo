import type { OpenCode } from "@opencode/client"

export type NativeRunOptions = {
  message: string
  agent?: string
  model?: string
  timestamp?: boolean
  verbose?: boolean
  directory?: string
  port?: number
  attach?: string
  onComplete?: string
  json?: boolean
  sessionId?: string
}

export type NativeRunResult = {
  sessionId: string
  success: boolean
  durationMs: number
  messageCount: number
  summary: string
}

export type NativeOpenCodeClient = ReturnType<typeof OpenCode.make>
