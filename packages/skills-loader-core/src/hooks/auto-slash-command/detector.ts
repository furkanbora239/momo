import { isRealUserTextPart } from "../../shared/internal-initiator-marker"
import {
  EXCLUDED_COMMANDS,
  SLASH_COMMAND_PATTERN,
} from "./constants"
import type { ParsedSlashCommand, SlashCommandToken } from "./types"

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g
const SLASH_TOKEN_PATTERN = /(^|[\s(])\/([a-zA-Z@][\w.-]+)/g
const FENCE_MARKER = "```"

export function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "")
}

export function parseSlashCommand(text: string): ParsedSlashCommand | null {
  const trimmed = text.trim()

  if (!trimmed.startsWith("/")) {
    return null
  }

  const match = trimmed.match(SLASH_COMMAND_PATTERN)
  if (!match) {
    return null
  }

  const [raw, command, args] = match
  return {
    command: command.toLowerCase(),
    args: args.trim(),
    raw,
  }
}

export function isExcludedCommand(command: string): boolean {
  return EXCLUDED_COMMANDS.has(command.toLowerCase())
}

export function detectSlashCommand(text: string): ParsedSlashCommand | null {
  const textWithoutCodeBlocks = removeCodeBlocks(text)
  const trimmed = textWithoutCodeBlocks.trim()

  if (!trimmed.startsWith("/")) {
    return null
  }

  const parsed = parseSlashCommand(trimmed)

  if (!parsed) {
    return null
  }

  if (isExcludedCommand(parsed.command)) {
    return null
  }

  return parsed
}

function collectSlashCommandTokens(
  segment: string,
  offset: number,
  tokens: SlashCommandToken[],
): void {
  SLASH_TOKEN_PATTERN.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = SLASH_TOKEN_PATTERN.exec(segment)) !== null) {
    const command = match[2].toLowerCase()
    if (isExcludedCommand(command)) {
      continue
    }
    tokens.push({
      command,
      tokenStart: offset + match.index + match[1].length,
      tokenEnd: offset + match.index + match[0].length,
    })
  }
}

export function findSlashCommandTokens(text: string): SlashCommandToken[] {
  const tokens: SlashCommandToken[] = []
  let segmentStart = 0
  let inFence = false
  let i = 0

  while (i < text.length) {
    if (text.startsWith(FENCE_MARKER, i)) {
      if (!inFence) {
        collectSlashCommandTokens(text.slice(segmentStart, i), segmentStart, tokens)
      }
      inFence = !inFence
      i += FENCE_MARKER.length
      segmentStart = i
      continue
    }
    i += 1
  }

  if (!inFence) {
    collectSlashCommandTokens(text.slice(segmentStart), segmentStart, tokens)
  }

  return tokens
}

export function extractPromptText(
  parts: Array<{ type: string; text?: string; synthetic?: boolean }>
): string {
  const textParts = parts.filter(isRealUserTextPart)
  const slashPart = textParts.find((p) => (p.text ?? "").trim().startsWith("/"))
  if (slashPart?.text) {
    return slashPart.text
  }

  return textParts.map((p) => p.text || "").join(" ")
}

export function findSlashCommandPartIndex(
  parts: Array<{ type: string; text?: string; synthetic?: boolean }>
): number {
  for (let idx = 0; idx < parts.length; idx += 1) {
    const part = parts[idx]
    if (!isRealUserTextPart(part)) continue
    if ((part.text ?? "").trim().startsWith("/")) {
      return idx
    }
  }
  return -1
}
